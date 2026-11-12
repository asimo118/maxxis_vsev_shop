import { Redis } from "ioredis";
import type { Clock } from "./clock";

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export class MemoryCache implements Cache {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly clock: Clock) {}

  async get<T>(key: string): Promise<T | null> {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= this.clock.now().getTime()) {
      this.entries.delete(key);
      return null;
    }
    return JSON.parse(hit.value) as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.entries.set(key, {
      value: JSON.stringify(value),
      expiresAt: this.clock.now().getTime() + ttlSeconds * 1000
    });
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

export class RedisCache implements Cache {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async ping(): Promise<boolean> {
    return (await this.redis.ping()) === "PONG";
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
