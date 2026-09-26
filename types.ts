
export enum CardType {
  NECO = 'NECO Token',
  WAEC = 'WAEC PIN',
  NABTEB = 'NABTEB PIN',
  NBAIS = 'NBAIS PIN',
  NYSC = 'NYSC WAEC Result Verification PIN',
  NECO_EVERIFY = 'NECO Everification PIN',
  UNKNOWN = 'Voucher',
}

export type VoucherStatus = 'unused' | 'used';

export interface VoucherCard {
  id: string;
  originalText?: string;
  pin: string;
  serial: string;
  type: CardType;
  formattedText: string;
  status: VoucherStatus;
  sentAt?: string;
  recipient?: string;
}

export interface BrandingLogos {
  [CardType.WAEC]?: string;
  [CardType.NECO]?: string;
  [CardType.NABTEB]?: string;
  [CardType.NBAIS]?: string;
  [CardType.NYSC]?: string;
  [CardType.NECO_EVERIFY]?: string;
}

export interface ParsingResult {
  success: boolean;
  data?: VoucherCard[];
  error?: string;
}
