import { GoogleGenAI, Type } from "@google/genai";
import { CardType, VoucherCard } from '../types';

const PORTAL_LINKS = {
  [CardType.WAEC]: 'https://www.waecdirect.org/',
  [CardType.NECO]: 'https://results.neco.gov.ng/',
  [CardType.NABTEB]: 'https://eworld.nabteb.gov.ng/',
  [CardType.NBAIS]: 'https://resultchecker.nbais.com.ng/',
  [CardType.NYSC]: 'https://portal.nysc.org.ng/',
  [CardType.NECO_EVERIFY]: 'https://everify.neco.gov.ng/',
  [CardType.UNKNOWN]: '#'
};

export const parseUnstructuredText = async (text: string): Promise<VoucherCard[]> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please provide a valid API Key.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const systemInstruction = `
    You are a specialized data extraction assistant for educational vouchers.
    Your task is to identify PINs and Serial Numbers from the provided text.
    
    Rules for identification:
    1. A 'PIN' is typically a sequence of digits (usually 10-15 digits).
    2. A 'Serial' is typically alphanumeric.
    3. Determine the 'type' based on the Serial Number or context (Priority order matters):
       - Serial starts with or contains 'EVERIFY', 'EVERIFICATION', 'NECOEV', 'NECO-EV', 'NEV', or text refers to NECO Everification: CardType is 'NECO Everification PIN'.
       - Serial starts with 'NYSC' or contains 'NYSC': CardType is 'NYSC WAEC Result Verification PIN'.
       - Serial starts with 'NBAIS' or contains 'NBAIS': CardType is 'NBAIS PIN'.
       - Serial starts with 'NER': CardType is 'NABTEB PIN'.
       - Serial starts with 'NE': CardType is 'NECO Token'.
       - Serial starts with 'WRN': CardType is 'WAEC PIN'.
       - Otherwise: CardType is 'Voucher'.
    
    If multiple items are found, extract all of them.
    Return a clean JSON array of objects.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Extract vouchers from this text:\n\n${text}`,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              pin: { type: Type.STRING, description: "The extracted PIN number" },
              serial: { type: Type.STRING, description: "The extracted Serial number" },
              type: { 
                type: Type.STRING, 
                enum: [CardType.NECO, CardType.WAEC, CardType.NABTEB, CardType.NBAIS, CardType.NYSC, CardType.NECO_EVERIFY, CardType.UNKNOWN],
                description: "The detected card type"
              }
            },
            required: ["pin", "serial", "type"]
          }
        }
      }
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) return [];

    const parsed = JSON.parse(jsonStr);
    
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: any) => formatVoucher(item.pin, item.serial, item.type));

  } catch (error) {
    console.error("Gemini Extraction Error:", error);
    throw new Error("Failed to process text with AI.");
  }
};

const formatVoucher = (pin: string, serial: string, type: CardType): VoucherCard => {
  const portal = PORTAL_LINKS[type] || '#';
  const formattedText = `*${type}*\n*PIN:* ${pin}\n*Serial:* ${serial}\n\n*Check result here:* ${portal}\n\nThank you for your purchase!`;
  return {
    id: crypto.randomUUID(),
    pin,
    serial,
    type,
    formattedText,
    status: 'unused'
  };
};