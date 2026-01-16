
import { GoogleGenAI, Type } from "@google/genai";
import { CardType, VoucherCard } from '../types';

// We use Gemini to handle messy input (e.g., email forwards, mixed text)
// that simple regex cannot handle efficiently.

export const parseUnstructuredText = async (text: string): Promise<VoucherCard[]> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please provide a valid API Key.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const systemInstruction = `
    You are a specialized data extraction assistant for educational vouchers.
    Your task is to identify PINs and Serial Numbers from the provided text.
    
    Rules for identification:
    1. A 'PIN' is typically a long sequence of digits (10-15 digits).
    2. A 'Serial' is typically alphanumeric.
    3. Determine the 'type' based on the Serial Number:
       - Starts with 'NE' followed immediately by numbers: NECO Token.
       - Starts with 'WRN': WAEC PIN.
       - Starts with 'NER': NABTEB PIN.
       - Otherwise: Unknown/Voucher.
    
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
                enum: [CardType.NECO, CardType.WAEC, CardType.NABTEB, CardType.UNKNOWN],
                description: "The detected card type"
              }
            },
            required: ["pin", "serial", "type"]
          }
        }
      }
    });

    const jsonStr = response.text;
    if (!jsonStr) return [];

    const parsed = JSON.parse(jsonStr);
    
    // Map to our internal format
    return parsed.map((item: any) => formatVoucher(item.pin, item.serial, item.type));

  } catch (error) {
    console.error("Gemini Extraction Error:", error);
    throw new Error("Failed to process text with AI. Please try manual entry or standard format.");
  }
};

// Helper to format consistent with the app's regex logic
const formatVoucher = (pin: string, serial: string, type: CardType): VoucherCard => {
  const formattedText = `*${type}*\n*PIN:* ${pin}\n*Serial:* ${serial}`;
  return {
    id: crypto.randomUUID(),
    originalText: `${pin} ${serial}`,
    pin,
    serial,
    type,
    formattedText
  };
};
