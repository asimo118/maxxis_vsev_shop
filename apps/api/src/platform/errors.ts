import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from "@vsev/shared";

const HTTP_STATUS: Record<ErrorCode, number> = {
  E1000: 400,
  E1001: 401,
  E1003: 403,
  E1004: 404,
  E1009: 409,
  E2001: 422,
  E2002: 422,
  E2003: 422,
  E2004: 422,
  E2005: 422,
  E2006: 409,
  E2007: 422,
  E2008: 422,
  E2009: 402,
  E2010: 422,
  E2011: 422,
  E2012: 409,
  E5000: 500,
  E5001: 502
};

/** A business/validation failure that is safe to show the customer. Anything else becomes E5000. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = "AppError";
    this.status = HTTP_STATUS[code];
  }
}

export const errors = {
  validation: (details?: unknown) => new AppError(ERROR_CODES.VALIDATION_FAILED, undefined, details),
  unauthenticated: () => new AppError(ERROR_CODES.UNAUTHENTICATED),
  forbidden: (message?: string) => new AppError(ERROR_CODES.FORBIDDEN, message),
  notFound: (message?: string) => new AppError(ERROR_CODES.NOT_FOUND, message),
  conflict: (message?: string) => new AppError(ERROR_CODES.CONFLICT, message),
  campaignNotLive: () => new AppError(ERROR_CODES.CAMPAIGN_NOT_LIVE),
  orderDeadlinePassed: () => new AppError(ERROR_CODES.ORDER_DEADLINE_PASSED),
  vehicleNotEligible: () => new AppError(ERROR_CODES.VEHICLE_NOT_ELIGIBLE),
  shopNotAvailable: () => new AppError(ERROR_CODES.SHOP_NOT_AVAILABLE),
  deadlineNotAcknowledged: () => new AppError(ERROR_CODES.DEADLINE_NOT_ACKNOWLEDGED),
  invalidTransition: (from: string, to: string) =>
    new AppError(ERROR_CODES.INVALID_TRANSITION, undefined, { from, to }),
  referralInvalid: () => new AppError(ERROR_CODES.REFERRAL_INVALID),
  bookingSlotInvalid: () => new AppError(ERROR_CODES.BOOKING_SLOT_INVALID),
  paymentFailed: () => new AppError(ERROR_CODES.PAYMENT_FAILED),
  installDeadlinePassed: () => new AppError(ERROR_CODES.INSTALL_DEADLINE_PASSED),
  insufficientPoints: () => new AppError(ERROR_CODES.INSUFFICIENT_POINTS),
  managedExternally: (message?: string) => new AppError(ERROR_CODES.MANAGED_EXTERNALLY, message),
  connectorUnavailable: (connector: string) =>
    new AppError(ERROR_CODES.CONNECTOR_UNAVAILABLE, undefined, { connector })
};
