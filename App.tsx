
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Copy, Trash2, Smartphone, Wand2, RefreshCw, CheckCircle2, 
  AlertCircle, Clock, Heart, Send, Upload, History, LayoutDashboard,
  Download, Check, Calculator, ChevronRight, X, Image as ImageIcon, 
  Wifi, WifiOff, Settings, Camera, Layers, ExternalLink
} from 'lucide-react';
import { CardType, VoucherCard, VoucherStatus, BrandingLogos } from './types';
import { parseUnstructuredText } from './services/geminiService';

// --- Constants & Persistence Keys ---
const STORAGE_KEY_CARDS = 'pinformatter_active_cards';
const STORAGE_KEY_HISTORY = 'pinformatter_transaction_log';
const STORAGE_KEY_LOGOS = 'pinformatter_custom_logos';

const PORTAL_LINKS = {
  [CardType.WAEC]: 'https://www.waecdirect.org/',
  [CardType.NECO]: 'https://results.neco.gov.ng/',
  [CardType.NABTEB]: 'https://eworld.nabteb.gov.ng/',
  [CardType.UNKNOWN]: '#'
};

const BASE_PRICES = {
  [CardType.WAEC]: 4000,
  [CardType.NECO]: 1500,
  [CardType.NABTEB]: 1500,
  [CardType.UNKNOWN]: 0
};

// --- Helper Functions ---

/**
 * Robust detection of card type based on serial number patterns.
 */
const identifyType = (serial: string): CardType => {
  const sUpper = serial.toUpperCase().trim();
  if (sUpper.startsWith('NE')) return CardType.NECO;
  if (sUpper.startsWith('WRN')) return CardType.WAEC;
  if (sUpper.startsWith('NER')) return CardType.NABTEB;
  return CardType.UNKNOWN;
};

const formatGroupForWhatsApp = (type: CardType, cards: VoucherCard[]): string => {
  const portal = PORTAL_LINKS[type];
  const pinsList = cards.map((c, i) => `${i + 1}. *PIN:* ${c.pin} | *SN:* ${c.serial}`).join('\n');
  return `*${type}*\n\n${pinsList}\n\n*Check result here:* ${portal}\n\nThank you for your purchase!`;
};

const formatSingleForWhatsApp = (card: VoucherCard): string => {
  const portal = PORTAL_LINKS[card.type];
  return `*${card.type}*\n*PIN:* ${card.pin}\n*Serial:* ${card.serial}\n\n*Check result here:* ${portal}\n\nThank you for your purchase!`;
};

const createVoucherObject = (pin: string, serial: string, originalText?: string): VoucherCard => {
  const type = identifyType(serial);
  return {
    id: crypto.randomUUID(),
    pin,
    serial,
    type,
    originalText,
    formattedText: '', 
    status: 'unused'
  };
};

/**
 * Advanced local parser that works offline.
 * Detects PINs (10+ digits) and Serials (alphanumeric).
 */
const parseInputLocally = (input: string): VoucherCard[] => {
  const lines = input.split(/\n/);
  const results: VoucherCard[] = [];
  
  let pendingPin: string | null = null;
  let pendingSerial: string | null = null;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    
    const cleanedLine = trimmed
      .replace(/Pins?[:\s]*/gi, ' ')
      .replace(/Serial\s*No?[:\s]*/gi, ' ')
      .replace(/SN[:\s]*/gi, ' ')
      .replace(/Not\s*Used/gi, ' ');
    
    const rawParts = cleanedLine.split(/[\s\t,]+/).filter(p => p.trim().length > 0);
    
    const pin = rawParts.find(p => /^\d{10,}$/.test(p));
    
    const serial = rawParts.find(p => {
      if (p === pin) return false;
      const up = p.toUpperCase();
      if (up.startsWith('WRN') || up.startsWith('NE') || up.startsWith('NER')) return true;
      return /^[A-Z0-9]{5,}$/i.test(p) && /[A-Z]/i.test(p);
    });

    if (pin && serial) {
      results.push(createVoucherObject(pin, serial, line));
      pendingPin = null; 
      pendingSerial = null;
    } else {
      if (pin) pendingPin = pin;
      if (serial) pendingSerial = serial;

      if (pendingPin && pendingSerial) {
        results.push(createVoucherObject(pendingPin, pendingSerial, "Composite Match"));
        pendingPin = null;
        pendingSerial = null;
      }
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

const BrandingModal = ({ logos, onUpdate, onClose }: { logos: BrandingLogos, onUpdate: (newLogos: BrandingLogos) => void, onClose: () => void }) => {
  const handleLogoUpload = (type: CardType, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      onUpdate({ ...logos, [type]: base64 });
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = (type: CardType) => {
    const next = { ...logos };
    delete next[type];
    onUpdate(next);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <ImageIcon className="text-green-600" /> Receipt Branding
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        <div className="p-6 space-y-6">
          <p className="text-sm text-slate-500">Upload logos for each exam body to make your digital receipts look professional.</p>
          {[CardType.WAEC, CardType.NECO, CardType.NABTEB].map(type => (
            <div key={type} className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200">
              <div className="w-16 h-16 bg-white rounded-xl border border-slate-200 flex items-center justify-center overflow-hidden relative group">
                {logos[type] ? (
                  <img src={logos[type]} alt={type} className="w-full h-full object-contain p-1" />
                ) : (
                  <ImageIcon className="text-slate-200" size={32} />
                )}
                <label className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                  <Camera className="text-white" size={20} />
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleLogoUpload(type, e)} />
                </label>
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-slate-800 text-sm">{type}</h4>
                <p className="text-[10px] text-slate-400">{logos[type] ? 'Custom logo uploaded' : 'Using default header style'}</p>
              </div>
              {logos[type] && (
                <button onClick={() => removeLogo(type)} className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const PriceCalculatorModal = ({ onClose }: { onClose: () => void }) => {
  const [counts, setCounts] = useState({
    [CardType.WAEC]: 0,
    [CardType.NECO]: 0,
    [CardType.NABTEB]: 0
  });

  const calculateItemTotal = (type: CardType, qty: number) => {
    const base = BASE_PRICES[type];
    const discounted = base * 0.9;
    let charge = 0;
    if (base > 4000) charge = 160;
    else if (base > 1000) charge = 100;
    return (discounted + charge) * qty;
  };

  const grandTotal = Object.entries(counts).reduce((acc, [type, qty]) => {
    return acc + calculateItemTotal(type as CardType, qty as number);
  }, 0);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Calculator className="text-green-600" /> Price Calculator
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {[CardType.WAEC, CardType.NECO, CardType.NABTEB].map(type => (
            <div key={type} className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="flex flex-col">
                <span className="text-sm font-bold text-slate-700">{type}</span>
                <span className="text-[10px] text-slate-500">Base: ₦{BASE_PRICES[type]}</span>
              </div>
              <div className="flex items-center gap-3">
                <input 
                  type="number" 
                  min="0"
                  className="w-16 p-2 rounded-lg border border-slate-200 text-center font-bold text-slate-700"
                  value={counts[type as keyof typeof counts]}
                  onChange={(e) => setCounts({...counts, [type]: Math.max(0, parseInt(e.target.value) || 0)})}
                />
                <div className="w-24 text-right font-bold text-green-700">
                  ₦{calculateItemTotal(type as CardType, counts[type as keyof typeof counts]).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
          <div className="pt-4 border-t border-dashed border-slate-200">
            <div className="flex justify-between items-center mb-1">
              <span className="text-slate-500 font-medium">Total Payable</span>
              <span className="text-2xl font-black text-slate-900 tracking-tight">₦{grandTotal.toLocaleString()}</span>
            </div>
            <p className="text-[10px] text-slate-400 italic">Incl. 10% discount & bank charges per unit.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

interface GroupedVoucherSectionProps {
  type: CardType;
  cards: VoucherCard[];
  logos: BrandingLogos;
  onDelete: (id: string) => void;
  onMarkUsed: (id: string) => void;
  onSentGroup: (type: CardType, cards: VoucherCard[]) => void;
}

const GroupedVoucherSection: React.FC<GroupedVoucherSectionProps> = ({ type, cards, logos, onDelete, onMarkUsed, onSentGroup }) => {
  const [copiedGroup, setCopiedGroup] = useState(false);
  const [copiedIndividual, setCopiedIndividual] = useState<Record<string, boolean>>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleCopyGroup = async () => {
    const combinedText = formatGroupForWhatsApp(type, cards);
    try {
      await navigator.clipboard.writeText(combinedText);
      setCopiedGroup(true);
      cards.forEach(c => onMarkUsed(c.id));
      setTimeout(() => setCopiedGroup(false), 2000);
    } catch (err) {
      console.error('Failed to copy group', err);
    }
  };

  const handleSendGroup = () => {
    const combinedText = formatGroupForWhatsApp(type, cards);
    const text = encodeURIComponent(combinedText);
    window.open(`https://wa.me/?text=${text}`, '_blank');
    onSentGroup(type, cards);
  };

  const handleCopySingle = async (card: VoucherCard) => {
    const text = formatSingleForWhatsApp(card);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndividual(prev => ({ ...prev, [card.id]: true }));
      onMarkUsed(card.id);
      setTimeout(() => setCopiedIndividual(prev => ({ ...prev, [card.id]: false })), 2000);
    } catch (err) {
      console.error('Failed to copy single', err);
    }
  };

  const downloadReceipt = async (card: VoucherCard) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 450;
    canvas.height = 300;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

    const headerColors = {
      [CardType.WAEC]: '#eab308',
      [CardType.NECO]: '#10b981',
      [CardType.NABTEB]: '#a855f7',
      [CardType.UNKNOWN]: '#64748b'
    };
    ctx.fillStyle = headerColors[card.type] || '#64748b';
    ctx.fillRect(10, 10, canvas.width - 20, 70);

    const customLogo = logos[card.type];
    if (customLogo) {
      try {
        const img = new Image();
        img.src = customLogo;
        await new Promise((resolve) => {
          img.onload = () => {
            ctx.save();
            ctx.beginPath();
            ctx.arc(65, 45, 25, 0, Math.PI * 2);
            ctx.clip();
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(40, 20, 50, 50);
            ctx.drawImage(img, 40, 20, 50, 50);
            ctx.restore();
            resolve(true);
          };
          img.onerror = resolve;
        });
      } catch (err) { console.error("Logo draw error", err); }
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 24px sans-serif';
    ctx.fillText(card.type, customLogo ? 100 : 30, 52);
    ctx.font = '700 10px sans-serif';
    ctx.fillText('INTECH VOUCHER RECEIPT', customLogo ? 100 : 30, 68);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 12px sans-serif';
    ctx.fillText('PIN CODE', 30, 120);
    ctx.fillStyle = '#1e293b';
    ctx.font = '900 32px monospace';
    ctx.fillText(card.pin, 30, 155);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 12px sans-serif';
    ctx.fillText('SERIAL NUMBER', 30, 200);
    ctx.fillStyle = '#475569';
    ctx.font = '700 24px monospace';
    ctx.fillText(card.serial, 30, 230);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'italic 10px sans-serif';
    ctx.fillText('Thank you for your purchase!', 30, 268);
    ctx.fillText('Thanks for choosing Intech.org.ng', 30, 282);
    ctx.fillText(new Date().toLocaleDateString(), 330, 282);

    const link = document.createElement('a');
    link.download = `Receipt-${card.type}-${card.serial}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const getThemeColor = (type: CardType) => {
    switch (type) {
      case CardType.NECO: return 'emerald';
      case CardType.WAEC: return 'yellow';
      case CardType.NABTEB: return 'purple';
      default: return 'slate';
    }
  };

  const theme = getThemeColor(type);

  return (
    <div className={`bg-white rounded-[40px] border border-slate-200 overflow-hidden shadow-sm mb-8 transition-all hover:shadow-md border-l-[12px] ${
      type === CardType.NECO ? 'border-emerald-500' : 
      type === CardType.WAEC ? 'border-yellow-500' : 
      'border-purple-500'
    }`}>
      <canvas ref={canvasRef} className="hidden" />
      
      {/* Group Header */}
      <div className="px-8 py-6 bg-slate-50/50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {logos[type] ? (
            <img src={logos[type]} className="w-10 h-10 rounded-xl object-contain border bg-white p-1 shadow-sm" alt="logo" />
          ) : (
            <div className={`w-10 h-10 rounded-xl bg-${theme}-500 flex items-center justify-center text-white shadow-lg shadow-${theme}-100`}>
              <Layers size={22} />
            </div>
          )}
          <div>
            <h4 className="font-black text-slate-800 tracking-tight uppercase text-base">{type}s</h4>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{cards.length} items queued</p>
          </div>
        </div>
        <div className="flex gap-3">
           <button 
             onClick={handleCopyGroup}
             className={`px-4 py-2 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
               copiedGroup ? 'bg-green-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
             }`}
           >
             {copiedGroup ? <CheckCircle2 size={14} /> : <Copy size={14} />}
             {copiedGroup ? 'Combined Copied' : 'Copy Combined'}
           </button>
           <button 
             onClick={handleSendGroup}
             className="px-4 py-2 rounded-2xl text-[11px] font-black uppercase tracking-widest bg-green-600 text-white hover:bg-green-700 transition-all flex items-center gap-2 shadow-lg shadow-green-100"
           >
             <Send size={14} />
             Send Combined
           </button>
        </div>
      </div>

      {/* Group Items */}
      <div className="p-4 space-y-4">
        {cards.map((card, idx) => (
          <div key={card.id} className="p-6 bg-slate-50/50 rounded-[28px] border border-slate-100 group hover:border-slate-200 transition-all">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              
              <div className="flex items-center gap-5 flex-1 w-full">
                 <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[11px] font-black text-slate-400 shrink-0 shadow-sm">
                   {idx + 1}
                 </div>
                 <div className="space-y-3 w-full">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{card.type} PIN</span>
                      <div className={`font-mono text-xl font-black tracking-widest transition-all ${card.status === 'used' ? 'text-slate-300 line-through' : 'text-slate-900'}`}>
                        {card.pin}
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Serial No.</span>
                      <div className="font-mono text-sm font-bold text-slate-500 tracking-wider">
                        {card.serial}
                      </div>
                    </div>
                 </div>
              </div>
              
              <div className="flex items-center gap-3 w-full md:w-auto pt-4 md:pt-0 border-t md:border-t-0 border-slate-100">
                 <button 
                   onClick={() => handleCopySingle(card)}
                   className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
                     copiedIndividual[card.id] ? 'bg-green-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                   }`}
                   title="Copy single text"
                 >
                   {copiedIndividual[card.id] ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                   <span className="md:hidden">Copy</span>
                 </button>
                 <button 
                   onClick={() => downloadReceipt(card)}
                   className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 transition-all"
                   title="Download Image Receipt"
                 >
                   <ImageIcon size={18} />
                   <span className="md:hidden text-xs font-black uppercase tracking-widest">Receipt</span>
                 </button>
                 <button 
                   onClick={() => onDelete(card.id)}
                   className="p-3 rounded-2xl bg-red-50 text-red-400 border border-red-100 hover:bg-red-100 transition-all"
                   title="Delete Voucher"
                 >
                   <Trash2 size={18} />
                 </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* Group Footer Actions */}
      <div className="px-8 py-4 bg-slate-50/30 border-t border-slate-100 flex justify-between items-center">
         <a 
          href={PORTAL_LINKS[type]} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-[10px] font-black text-slate-400 hover:text-blue-500 flex items-center gap-1.5 uppercase tracking-widest transition-colors"
         >
           <ExternalLink size={12} /> {type} Portal
         </a>
      </div>
    </div>
  );
};

export default function App() {
  const [view, setView] = useState<'generator' | 'history'>('generator');
  const [inputText, setInputText] = useState('');
  const [cards, setCards] = useState<VoucherCard[]>([]);
  const [history, setHistory] = useState<VoucherCard[]>([]);
  const [logos, setLogos] = useState<BrandingLogos>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showBranding, setShowBranding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const groupedCards = useMemo<Record<CardType, VoucherCard[]>>(() => {
    const groups: Record<CardType, VoucherCard[]> = {
      [CardType.WAEC]: [],
      [CardType.NECO]: [],
      [CardType.NABTEB]: [],
      [CardType.UNKNOWN]: []
    };
    cards.forEach(card => {
      groups[card.type].push(card);
    });
    return groups;
  }, [cards]);

  const totalInQueue = cards.length;

  // --- Persistence ---
  useEffect(() => {
    const savedCards = localStorage.getItem(STORAGE_KEY_CARDS);
    const savedHistory = localStorage.getItem(STORAGE_KEY_HISTORY);
    const savedLogos = localStorage.getItem(STORAGE_KEY_LOGOS);
    if (savedCards) setCards(JSON.parse(savedCards) as VoucherCard[]);
    if (savedHistory) setHistory(JSON.parse(savedHistory) as VoucherCard[]);
    if (savedLogos) setLogos(JSON.parse(savedLogos) as BrandingLogos);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => localStorage.setItem(STORAGE_KEY_CARDS, JSON.stringify(cards)), [cards]);
  useEffect(() => localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history)), [history]);
  useEffect(() => localStorage.setItem(STORAGE_KEY_LOGOS, JSON.stringify(logos)), [logos]);

  // --- Auto-clear logic (20 seconds) ---
  useEffect(() => {
    if (cards.length > 0) {
      const timer = setTimeout(() => {
        setCards([]);
        setToast({ msg: "Queue auto-cleared (20s inactivity)", type: "success" });
      }, 20000);
      return () => clearTimeout(timer);
    }
  }, [cards]);

  const clearAll = () => {
    setInputText('');
    setCards([]);
    setToast({ msg: "Queue cleared", type: "success" });
  };

  const handleBulkImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const results = parseInputLocally(content);
      if (Array.isArray(results) && results.length > 0) {
        setCards(prev => [...prev, ...results]);
        setToast({ msg: `Imported ${results.length} items!`, type: "success" });
      } else {
        setToast({ msg: "No valid vouchers found.", type: "error" });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAiFix = async () => {
    if (!isOnline) {
      setToast({ msg: "AI features require internet connection.", type: "error" });
      return;
    }
    if (!inputText.trim()) {
      setToast({ msg: "Please paste text first.", type: "error" });
      return;
    }
    setIsProcessing(true);
    try {
      const results = await parseUnstructuredText(inputText);
      if (Array.isArray(results) && results.length > 0) {
        setCards(prev => [...prev, ...results]);
        setToast({ msg: `AI identified ${results.length} vouchers!`, type: "success" });
        setInputText('');
      } else {
        setToast({ msg: "AI couldn't extract any vouchers.", type: "error" });
      }
    } catch (e: any) {
      setToast({ msg: e.message || "AI Error", type: "error" });
    } finally {
      setIsProcessing(false);
    }
  };

  const markUsed = (id: string) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'used' } : c));
  };

  const handleSentGroup = (type: CardType, groupCards: VoucherCard[]) => {
    const timestamp = new Date().toISOString();
    const historyEntries = groupCards.map(c => ({
      ...c,
      status: 'used' as VoucherStatus,
      sentAt: timestamp
    }));
    setHistory(prev => [...historyEntries, ...prev]);
    setCards(prev => prev.map(c => groupCards.some(gc => gc.id === c.id) ? { ...c, status: 'used' } : c));
  };

  const deleteCard = (id: string) => setCards(prev => prev.filter(c => c.id !== id));
  const deleteHistoryItem = (id: string) => setHistory(prev => prev.filter(h => h.id !== id));
  const clearHistory = () => {
    if (confirm("Clear transaction log?")) {
      setHistory([]);
      setToast({ msg: "History wiped", type: "success" });
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col selection:bg-green-100 selection:text-green-900">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center text-white shadow-xl shadow-green-100 transition-transform hover:scale-105">
              <Smartphone size={24} />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-xl font-black text-slate-800 leading-none">PinFormatter</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                {isOnline ? (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-green-500 uppercase tracking-widest"><Wifi size={10} /> Live</span>
                ) : (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest"><WifiOff size={10} /> Offline Mode</span>
                )}
              </div>
            </div>
          </div>
          
          <nav className="flex bg-slate-100 p-1 rounded-2xl">
            <button
              onClick={() => setView('generator')}
              className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-black transition-all ${
                view === 'generator' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <LayoutDashboard size={18} />
              <span className="hidden sm:inline">Generator</span>
            </button>
            <button
              onClick={() => setView('history')}
              className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-black transition-all ${
                view === 'history' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <History size={18} />
              <span className="hidden sm:inline">History</span>
            </button>
          </nav>

          <div className="flex items-center gap-2 sm:gap-4">
             <button 
              onClick={() => setShowCalculator(true)}
              className="p-2.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-xl transition-all"
              title="Calculator"
             >
               <Calculator size={20} />
             </button>
             <button 
              onClick={() => setShowBranding(true)}
              className="p-2.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl transition-all"
              title="Branding"
             >
               <ImageIcon size={20} />
             </button>
             <input type="file" accept=".txt,.csv" ref={fileInputRef} onChange={handleBulkImport} className="hidden" />
             <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              title="Import"
             >
               <Upload size={20} />
             </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-10 grid grid-cols-1 lg:grid-cols-2 gap-10">
        {view === 'generator' ? (
          <>
            <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 overflow-hidden flex flex-col h-fit transition-all hover:shadow-md">
              <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h3 className="font-black text-slate-800 flex items-center gap-3">
                  <Settings size={20} className="text-green-600" />
                  Entry Box
                </h3>
                <button onClick={clearAll} className="text-[10px] text-slate-400 hover:text-red-500 font-black flex items-center gap-2 transition-colors uppercase tracking-widest">
                  <RefreshCw size={14} /> Reset all
                </button>
              </div>
              <div className="p-8 relative flex flex-col gap-6">
                <textarea
                  className="w-full h-96 p-8 bg-slate-50 rounded-[32px] border border-slate-200 focus:border-green-500 focus:ring-8 focus:ring-green-500/5 transition-all outline-none resize-none font-mono text-sm text-slate-700 placeholder:text-slate-300"
                  placeholder={`Paste list here...\nExample:\n367618921196\tNE07585150\n123456789012 WRN12345678`}
                  value={inputText}
                  onChange={(e) => {
                    setInputText(e.target.value);
                    const parsed = parseInputLocally(e.target.value);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                      setCards(prev => [...prev, ...parsed]);
                    }
                  }}
                />
                
                <button
                  onClick={handleAiFix}
                  disabled={isProcessing || !process.env.API_KEY || !isOnline}
                  className={`w-full py-6 rounded-[24px] font-black text-white transition-all shadow-xl flex items-center justify-center gap-4 text-lg
                    ${isProcessing ? 'bg-purple-400 cursor-wait' : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:scale-[1.01] active:scale-[0.99] shadow-purple-200'}
                    ${(!process.env.API_KEY || !isOnline) ? 'opacity-50 grayscale' : ''}
                  `}
                >
                  {isProcessing ? (
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                  ) : (
                    <Wand2 size={24} />
                  )}
                  {isProcessing ? 'Processing...' : 'AI Smart Extract'}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <div className="flex justify-between items-center px-4">
                <h3 className="font-black text-slate-800 flex items-center gap-3">
                  <LayoutDashboard size={20} className="text-green-600" />
                  Live Queue ({totalInQueue})
                </h3>
              </div>
              
              <div className="overflow-y-auto max-h-[850px] pr-2 space-y-4">
                {totalInQueue === 0 ? (
                  <div className="flex flex-col items-center justify-center py-32 text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-[48px]">
                    <div className="w-24 h-24 bg-slate-50 rounded-[40px] flex items-center justify-center mb-6">
                      <ImageIcon size={48} className="opacity-10 text-slate-900" />
                    </div>
                    <p className="text-xl font-black text-slate-300 uppercase tracking-widest">Queue empty</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Ready for input...</p>
                  </div>
                ) : (
                  (Object.entries(groupedCards) as [CardType, VoucherCard[]][]).map(([type, typeCards]) => (
                    typeCards.length > 0 && (
                      <GroupedVoucherSection 
                        key={type}
                        type={type}
                        cards={typeCards}
                        logos={logos}
                        onDelete={deleteCard}
                        onMarkUsed={markUsed}
                        onSentGroup={handleSentGroup}
                      />
                    )
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="col-span-full max-w-6xl mx-auto w-full">
            <div className="bg-white rounded-[48px] shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-10 border-b border-slate-100 flex flex-wrap justify-between items-center bg-slate-50/30 gap-6">
                <div>
                  <h2 className="text-3xl font-black text-slate-800 tracking-tight">Sales History</h2>
                  <p className="text-sm text-slate-500 font-bold uppercase tracking-widest mt-1">Stored locally in your browser</p>
                </div>
                {history.length > 0 && (
                  <button 
                    onClick={clearHistory}
                    className="flex items-center gap-2 px-8 py-4 rounded-2xl text-xs font-black text-red-600 hover:bg-red-50 border border-red-100 transition-all uppercase tracking-widest"
                  >
                    <Trash2 size={18} />
                    Wipe database
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                {history.length === 0 ? (
                  <div className="py-40 text-center">
                    <History size={80} className="mx-auto text-slate-100 mb-8" />
                    <p className="text-2xl font-black text-slate-200 uppercase tracking-[0.2em]">Zero Records</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase font-black tracking-widest">
                      <tr>
                        <th className="px-10 py-6">Identity</th>
                        <th className="px-10 py-6">Pin / SN</th>
                        <th className="px-10 py-6">Timestamp</th>
                        <th className="px-10 py-6 text-right">Delete</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {history.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-10 py-8">
                            <div className="flex items-center gap-3">
                              {logos[item.type] && (
                                <img src={logos[item.type]} className="w-6 h-6 rounded object-contain border border-slate-100" alt="sm" />
                              )}
                              <span className={`px-4 py-1 rounded-xl text-[10px] font-black uppercase border ${
                                item.type === CardType.WAEC ? 'bg-yellow-50 text-yellow-700 border-yellow-100' :
                                item.type === CardType.NECO ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                'bg-purple-50 text-purple-700 border-purple-100'
                              }`}>
                                {item.type}
                              </span>
                            </div>
                          </td>
                          <td className="px-10 py-8">
                            <div className="font-mono">
                              <div className="font-black text-slate-800 text-base">{item.pin}</div>
                              <div className="text-xs text-slate-400 font-bold uppercase mt-0.5">{item.serial}</div>
                            </div>
                          </td>
                          <td className="px-10 py-8">
                            <div className="text-xs text-slate-500 flex items-center gap-2 font-bold uppercase tracking-wider">
                              <Clock size={14} className="text-slate-300" />
                              {item.sentAt ? new Date(item.sentAt).toLocaleString() : 'N/A'}
                            </div>
                          </td>
                          <td className="px-10 py-8 text-right">
                            <button 
                              onClick={() => deleteHistoryItem(item.id)}
                              className="text-slate-200 hover:text-red-500 p-3 rounded-2xl hover:bg-red-50 transition-all"
                            >
                              <Trash2 size={20} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="md:hidden bg-white border-t border-slate-200 h-24 flex items-center justify-around sticky bottom-0 z-30 px-6 shadow-2xl">
        <button onClick={() => setView('generator')} className={`flex flex-col items-center gap-2 transition-all ${view === 'generator' ? 'text-green-600 scale-110' : 'text-slate-300'}`}>
          <LayoutDashboard size={24} />
          <span className="text-[9px] font-black uppercase tracking-widest">Queue</span>
        </button>
        <button onClick={() => setShowCalculator(true)} className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center text-white shadow-2xl shadow-green-200 -mt-10 border-4 border-white transition-transform active:scale-90">
          <Calculator size={28} />
        </button>
        <button onClick={() => setView('history')} className={`flex flex-col items-center gap-2 transition-all ${view === 'history' ? 'text-green-600 scale-110' : 'text-slate-300'}`}>
          <History size={24} />
          <span className="text-[9px] font-black uppercase tracking-widest">Logs</span>
        </button>
      </footer>

      {showBranding && <BrandingModal logos={logos} onUpdate={setLogos} onClose={() => setShowBranding(false)} />}
      {showCalculator && <PriceCalculatorModal onClose={() => setShowCalculator(false)} />}
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
