
import React, { useState, useEffect } from 'react';
import { Copy, Trash2, Smartphone, Wand2, RefreshCw, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { CardType, VoucherCard } from './types';
import { parseUnstructuredText } from './services/geminiService';

// --- Helper Functions (Deterministic Parsing) ---

const identifyType = (serial: string): CardType => {
  const sUpper = serial.toUpperCase().trim();
  
  // Logic: "Starts with NE only before numbers -> Neco"
  // Regex: ^NE\d+$
  if (/^NE\d+$/.test(sUpper)) {
    return CardType.NECO;
  }
  
  // Logic: "Starts with WRN -> Waec"
  if (sUpper.startsWith('WRN')) {
    return CardType.WAEC;
  }
  
  // Logic: "Starts with NER -> Nabteb"
  if (sUpper.startsWith('NER')) {
    return CardType.NABTEB;
  }
  
  return CardType.UNKNOWN;
};

const formatForWhatsApp = (type: CardType, pin: string, serial: string): string => {
  return `*${type}*\n*PIN:* ${pin}\n*Serial:* ${serial}`;
};

const parseInputLocally = (input: string): VoucherCard[] => {
  const lines = input.split(/\n/);
  const results: VoucherCard[] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Split by tab or multiple spaces
    const parts = trimmed.split(/\s+/);
    
    // We expect at least two parts: PIN and Serial
    if (parts.length >= 2) {
      let partA = parts[0];
      let partB = parts[1];
      
      let pin = "";
      let serial = "";

      // Heuristic: PIN is usually digits. Serial often has letters.
      const hasLettersA = /[a-zA-Z]/.test(partA);
      const hasLettersB = /[a-zA-Z]/.test(partB);

      if (hasLettersA && !hasLettersB) {
        // First part is serial, second is pin (swap)
        serial = partA;
        pin = partB;
      } else {
        // Standard: Pin then Serial (or ambiguous, default to this)
        pin = partA;
        serial = partB;
      }

      const type = identifyType(serial);
      const formatted = formatForWhatsApp(type, pin, serial);

      results.push({
        id: crypto.randomUUID(),
        originalText: line,
        pin,
        serial,
        type,
        formattedText: formatted
      });
    }
  });

  return results;
};

// --- Components ---

const Toast = ({ message, type = 'success', onClose }: { message: string, type?: 'success' | 'error', onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-white transform transition-all animate-fade-in-up z-50 ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
      {type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      <span className="font-medium text-sm">{message}</span>
    </div>
  );
};

interface CardPreviewProps {
  card: VoucherCard;
  onDelete: (id: string) => void;
}

const CardPreview: React.FC<CardPreviewProps> = ({ card, onDelete }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(card.formattedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  // Determine border color based on type
  const getTypeColor = (type: CardType) => {
    switch (type) {
      case CardType.NECO: return 'border-emerald-500 bg-emerald-50';
      case CardType.WAEC: return 'border-yellow-500 bg-yellow-50';
      case CardType.NABTEB: return 'border-purple-500 bg-purple-50';
      default: return 'border-slate-300 bg-white';
    }
  };

  const getBadgeColor = (type: CardType) => {
    switch (type) {
      case CardType.NECO: return 'bg-emerald-100 text-emerald-800';
      case CardType.WAEC: return 'bg-yellow-100 text-yellow-800';
      case CardType.NABTEB: return 'bg-purple-100 text-purple-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <div className={`relative p-4 rounded-xl border-l-4 shadow-sm hover:shadow-md transition-all mb-4 bg-white ${getTypeColor(card.type)}`}>
      <div className="flex justify-between items-start mb-2">
        <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${getBadgeColor(card.type)}`}>
          {card.type}
        </span>
        <button 
          onClick={() => onDelete(card.id)}
          className="text-slate-400 hover:text-red-500 transition-colors p-1"
          title="Remove"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="font-mono text-sm space-y-1 text-slate-800">
        <div className="flex">
          <span className="font-bold w-16 text-slate-500">PIN:</span>
          <span className="font-semibold select-all">{card.pin}</span>
        </div>
        <div className="flex">
          <span className="font-bold w-16 text-slate-500">SERIAL:</span>
          <span className="font-semibold select-all">{card.serial}</span>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-black/5 flex justify-end">
        <button
          onClick={handleCopy}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 ${
            copied 
              ? 'bg-green-600 text-white' 
              : 'bg-slate-900 text-white hover:bg-slate-700'
          }`}
        >
          {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
          {copied ? 'Copied!' : 'Copy for WhatsApp'}
        </button>
      </div>
    </div>
  );
};

export default function App() {
  const [inputText, setInputText] = useState('');
  const [cards, setCards] = useState<VoucherCard[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);

  const clearAll = () => {
    setInputText('');
    setCards([]);
  };

  // Auto-clear logic: Clear the queue automatically after 15 seconds of inactivity
  useEffect(() => {
    if (cards.length > 0) {
      const timer = setTimeout(() => {
        clearAll();
        setToast({ msg: "Queue cleared automatically", type: "success" });
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [cards]);

  // Deterministic live parsing
  useEffect(() => {
    if (!inputText.trim()) {
      return; 
    }

    const results = parseInputLocally(inputText);
    if (results.length > 0) {
      setCards(results);
    }
  }, [inputText]);

  const handleAiFix = async () => {
    if (!inputText.trim()) {
      setToast({ msg: "Please paste some text first.", type: "error" });
      return;
    }

    setIsProcessing(true);
    try {
      const results = await parseUnstructuredText(inputText);
      if (results.length === 0) {
        setToast({ msg: "AI couldn't find any vouchers.", type: "error" });
      } else {
        setCards(results);
        setToast({ msg: `AI found ${results.length} vouchers!`, type: "success" });
      }
    } catch (e: any) {
      setToast({ msg: e.message || "AI Error", type: "error" });
    } finally {
      setIsProcessing(false);
    }
  };

  const removeCard = (id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
  };

  const copyAll = async () => {
    if (cards.length === 0) return;
    const bulkText = cards.map(c => c.formattedText).join('\n\n------------------\n\n');
    await navigator.clipboard.writeText(bulkText);
    setToast({ msg: "All vouchers copied to clipboard!", type: "success" });
  };

  return (
    <div className="min-h-screen bg-[#e5ddd5] flex flex-col md:flex-row">
      {/* Left Panel: Input */}
      <div className="w-full md:w-1/2 p-6 flex flex-col h-[50vh] md:h-screen bg-white shadow-xl z-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Smartphone className="text-green-600" />
            Voucher<span className="text-green-600">Formatter</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Paste raw text to format for WhatsApp. Supports NECO, WAEC, NABTEB.
          </p>
        </div>

        <div className="flex-1 relative">
          <textarea
            className="w-full h-full p-4 bg-slate-50 rounded-xl border border-slate-200 focus:border-green-500 focus:ring-2 focus:ring-green-200 transition-all outline-none resize-none font-mono text-sm text-slate-700"
            placeholder={`Paste here...\nExample:\n111152728862 NE2672751101\n524353453453 WRN999283737`}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />
          {inputText && (
            <button 
              onClick={() => setInputText('')}
              className="absolute top-4 right-4 p-1 bg-slate-200 rounded-full hover:bg-slate-300 transition-colors text-slate-600"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>

        <div className="mt-4 flex gap-3">
          <button
            onClick={clearAll}
            className="px-4 py-3 rounded-xl font-semibold text-slate-600 hover:bg-slate-100 transition-colors flex items-center gap-2"
          >
            <RefreshCw size={18} />
            Reset
          </button>
          
          <button
            onClick={handleAiFix}
            disabled={isProcessing || !process.env.API_KEY}
            className={`flex-1 px-4 py-3 rounded-xl font-bold text-white transition-all shadow-lg shadow-purple-200 flex items-center justify-center gap-2 
              ${isProcessing ? 'bg-purple-400 cursor-wait' : 'bg-purple-600 hover:bg-purple-700 active:scale-95'}
              ${!process.env.API_KEY ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            title={!process.env.API_KEY ? "API Key required for AI features" : "Use AI to extract from messy text"}
          >
            {isProcessing ? (
              <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span>
            ) : (
              <Wand2 size={18} />
            )}
            Smart Extract (AI)
          </button>
        </div>
        {!process.env.API_KEY && (
             <p className="text-xs text-center text-slate-400 mt-2">Set API_KEY env var to enable AI features</p>
        )}
      </div>

      {/* Right Panel: Preview & Actions */}
      <div className="w-full md:w-1/2 p-6 overflow-y-auto h-[50vh] md:h-screen bg-[#e5ddd5] relative">
        <div className="max-w-md mx-auto">
          <div className="flex justify-between items-center mb-6 sticky top-0 bg-[#e5ddd5]/90 backdrop-blur-sm py-2 z-10">
            <div className="flex flex-col">
              <h2 className="text-lg font-bold text-slate-700">
                Results ({cards.length})
              </h2>
              {cards.length > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                  <Clock size={10} />
                  Auto-clears in 15s
                </div>
              )}
            </div>
            {cards.length > 0 && (
              <button
                onClick={copyAll}
                className="text-sm font-semibold text-green-700 hover:text-green-800 flex items-center gap-1 bg-white px-3 py-1.5 rounded-full shadow-sm"
              >
                <Copy size={14} />
                Copy All
              </button>
            )}
          </div>

          <div className="space-y-4 pb-20">
            {cards.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
                  <Copy size={24} className="opacity-50" />
                </div>
                <p>Formatted vouchers will appear here</p>
              </div>
            ) : (
              cards.map((card) => (
                <CardPreview key={card.id} card={card} onDelete={removeCard} />
              ))
            )}
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
