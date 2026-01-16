export enum CardType {
  NECO = 'NECO Token',
  WAEC = 'WAEC PIN',
  NABTEB = 'NABTEB PIN',
  UNKNOWN = 'Voucher',
}

export interface VoucherCard {
  id: string;
  originalText: string;
  pin: string;
  serial: string;
  type: CardType;
  formattedText: string;
}

export interface ParsingResult {
  success: boolean;
  data?: VoucherCard[];
  error?: string;
}
