import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Copy, Trash2, Smartphone, Wand2, RefreshCw, CheckCircle2, 
  AlertCircle, Clock, Heart, Send, Upload, History, LayoutDashboard,
  Download, Check, Calculator, ChevronRight, X, Image as ImageIcon, 
  Wifi, WifiOff, Settings, Camera, Layers, ExternalLink, Mail
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
 * Priority check: "NER" must be checked before "NE" to avoid false NECO detection.
 */
const identifyType = (serial: string): CardType => {
  const sUpper = serial.toUpperCase().trim();
  if (sUpper.startsWith('NER')) return CardType.NABTEB;
  if (sUpper.startsWith('NE')) return CardType.NECO;
  if (sUpper.startsWith('WRN')) return CardType.WAEC;
  return CardType.UNKNOWN;
};

const formatGroupForWhatsApp = (type: CardType, cards: VoucherCard[]): string => {
  const portal = PORTAL_LINKS[type];
  const pinsList = cards.map((c, i) => `${i + 1}. *PIN:* ${c.pin} | *SN:* ${c.serial}`).join('\n');
  return `*${type}*\n\n${pinsList}\n\n*Check result here:* ${portal}\n\nThank you for your purchase!`;
};

const formatSingleForWhatsApp = (card: VoucherCard): string => {
  const portal = PORTAL_LINKS[card.type];
  return `*${card.type}*\n*PIN:* ${card.pin}\n*Serial:* ${card.serial}\n\n*Check result here:* ${card.serial ? portal : '#'}\n\nThank you for your purchase!`;
};

const getPinLabel = (type: CardType) => {
  return type === CardType.NECO ? 'Token' : 'PIN';
};

const formatGroupForEmail = (type: CardType, cards: VoucherCard[]): { html: string; text: string } => {
  const portal = PORTAL_LINKS[type];
  const pinLabel = getPinLabel(type);
  const textPins = cards.map((c, i) => `${i + 1}. ${pinLabel}: ${c.pin} | SN: ${c.serial}`).join('\n');
  const plainText = `${type}\n\n${textPins}\n\nCheck result here: ${portal}\n\nThank you for your purchase!`;

  const htmlPins = cards.map((c, i) => `${i + 1}. <strong>${pinLabel}:</strong> ${c.pin} | <strong>SN:</strong> ${c.serial}`).join('<br>');
  const htmlText = `<strong>${type}</strong><br><br>${htmlPins}<br><br>Check result here: <a href="${portal}">${portal}</a><br><br>Thank you for your purchase!`;

  return { html: htmlText, text: plainText };
};

const formatSingleForEmail = (card: VoucherCard): { html: string; text: string } => {
  const portal = PORTAL_LINKS[card.type];
  const pinLabel = getPinLabel(card.type);
  const plainText = `${card.type}\n${pinLabel}: ${card.pin}\nSerial: ${card.serial}\n\nCheck result here: ${portal}\n\nThank you for your purchase!`;

  const htmlText = `<strong>${card.type}</strong><br><strong>${pinLabel}:</strong> ${card.pin}<br><strong>Serial:</strong> ${card.serial}<br><br>Check result here: <a href="${portal}">${portal}</a><br><br>Thank you for your purchase!`;

  return { html: htmlText, text: plainText };
};

const copyToClipboardAsHtmlAndText = async (html: string, plainText: string): Promise<boolean> => {
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      const htmlBlob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob([plainText], { type: 'text/plain' });
      const item = new ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch (e) {
      console.error('Failed to copy rich text using ClipboardItem, falling back to plain text', e);
    }
  }
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(plainText);
    return true;
  }
  return false;
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

const isIgnoredWord = (word: string): boolean => {
  const clean = word.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim();
  const ignored = [
    'STATUS', 'ACTION', 'NOT', 'USED', 'UNUSED', 'ACTIVE', 'INACTIVE', 
    'PENDING', 'SUCCESS', 'FAILED', 'DATE', 'TIME', 'AMOUNT', 'PRICE', 
    'EMAIL', 'NAME', 'TYPE', 'VOUCHER', 'CARD', 'PIN', 'PINS', 'SERIAL', 
    'SERIALS', 'NUMBER', 'NUMBERS', 'SN', 'NO', 'SELECT', 'VIEW', 'COPY', 
    'DELETE', 'PRINT', 'DOWNLOAD', 'CHECK', 'COMPLETED', 'EXPIRED', 'REDEEMED', 
    'REDEEM', 'DETAILS', 'PORTAL', 'LINK', 'TOKEN', 'TOKENS', 'TRANSACTION', 
    'LOG', 'HISTORY', 'COMPOSITE', 'MATCH'
  ];
  return ignored.includes(clean);
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
    
    const rawParts = cleanedLine
      .split(/[\s\t,]+/)
      .filter(p => p.trim().length > 0)
      .filter(p => !isIgnoredWord(p));
    
    const pin = rawParts.find(p => /^\d{10,}$/.test(p));
    
    const serial = rawParts.find(p => {
      if (p === pin) return false;
      const cleanP = p.replace(/[^a-zA-Z0-9]/g, '');
      if (isIgnoredWord(cleanP)) return false;
      const up = cleanP.toUpperCase();
      if (up.startsWith('WRN') || up.startsWith('NE') || up.startsWith('NER')) return true;
      return /^[A-Z0-9]{5,}$/i.test(cleanP) && /[A-Z]/i.test(cleanP);
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

const DownloadProgressOverlay: React.FC<{
  progress: number;
  stage: string;
  card: VoucherCard | null;
}> = ({ progress, stage, card }) => {
  if (!card) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/85 backdrop-blur-md z-[100] flex items-center justify-center p-4 text-white animate-fade-in">
      <div className="bg-white/10 border border-white/20 rounded-3xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl flex flex-col items-center gap-4">
        <div className="relative w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center bg-green-500/20 rounded-full border border-green-400/30">
          <Download className="w-8 h-8 sm:w-10 sm:h-10 text-green-400 animate-bounce" />
        </div>

        <div>
          <h3 className="text-lg sm:text-xl font-black tracking-tight text-white">Generating Receipt</h3>
          <p className="text-xs font-semibold text-slate-300 mt-1 uppercase tracking-wider">
            {card.type} • {card.pin.slice(0, 4)}••••
          </p>
        </div>

        {/* Progress bar container */}
        <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden p-0.5 border border-white/10">
          <div 
            className="bg-gradient-to-r from-green-500 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out shadow-lg"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>

        <div className="flex justify-between items-center w-full text-[11px] font-bold text-slate-300">
          <span className="truncate pr-2">{stage}</span>
          <span className="font-mono text-green-400 font-black">{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  );
};

const Toast = ({ message, type = 'success', onClose }: { message: string, type?: 'success' | 'error', onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:right-6 md:translate-x-0 px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 text-white transform transition-all animate-fade-in-up z-50 max-w-[90vw] ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
      {type === 'success' ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertCircle size={18} className="shrink-0" />}
      <span className="font-bold text-xs sm:text-sm truncate">{message}</span>
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl sm:rounded-[32px] shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-4 sm:p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-slate-800 flex items-center gap-2">
            <ImageIcon className="text-green-600" size={20} /> Receipt Branding
          </h2>
          <button onClick={onClose} className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto">
          <p className="text-xs sm:text-sm text-slate-500">Upload logos for each exam body to make your digital receipts look professional.</p>
          {[CardType.WAEC, CardType.NECO, CardType.NABTEB].map(type => (
            <div key={type} className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-slate-50 rounded-2xl border border-slate-200">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-white rounded-xl border border-slate-200 flex items-center justify-center overflow-hidden relative group shrink-0">
                {logos[type] ? (
                  <img src={logos[type]} alt={type} className="w-full h-full object-contain p-1" />
                ) : (
                  <ImageIcon className="text-slate-200" size={24} />
                )}
                <label className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                  <Camera className="text-white" size={18} />
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleLogoUpload(type, e)} />
                </label>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-slate-800 text-xs sm:text-sm">{type}</h4>
                <p className="text-[10px] text-slate-400 truncate">{logos[type] ? 'Custom logo uploaded' : 'Using default header style'}</p>
              </div>
              {logos[type] && (
                <button onClick={() => removeLogo(type)} className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors shrink-0">
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-4 sm:p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-slate-800 flex items-center gap-2">
            <Calculator className="text-green-600" size={20} /> Price Calculator
          </h2>
          <button onClick={onClose} className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
          {[CardType.WAEC, CardType.NECO, CardType.NABTEB].map(type => (
            <div key={type} className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100 gap-2">
              <div className="flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-bold text-slate-700">{type}</span>
                <span className="text-[10px] text-slate-500">Base: ₦{BASE_PRICES[type]}</span>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                <input 
                  type="number" 
                  min="0"
                  className="w-14 sm:w-16 p-1.5 sm:p-2 rounded-lg border border-slate-200 text-center font-bold text-slate-700 text-xs sm:text-sm"
                  value={counts[type as keyof typeof counts]}
                  onChange={(e) => setCounts({...counts, [type]: Math.max(0, parseInt(e.target.value) || 0)})}
                />
                <div className="w-20 sm:w-24 text-right font-bold text-green-700 text-xs sm:text-sm">
                  ₦{calculateItemTotal(type as CardType, counts[type as keyof typeof counts]).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
          <div className="pt-4 border-t border-dashed border-slate-200">
            <div className="flex justify-between items-center mb-1">
              <span className="text-slate-500 font-medium text-xs sm:text-sm">Total Payable</span>
              <span className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">₦{grandTotal.toLocaleString()}</span>
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
  const [copiedGroupEmail, setCopiedGroupEmail] = useState(false);
  const [copiedIndividual, setCopiedIndividual] = useState<Record<string, boolean>>({});
  const [copiedIndividualEmail, setCopiedIndividualEmail] = useState<Record<string, boolean>>({});
  const [downloadState, setDownloadState] = useState<{ card: VoucherCard; progress: number; stage: string } | null>(null);
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

  const handleCopyGroupEmail = async () => {
    const formatted = formatGroupForEmail(type, cards);
    try {
      await copyToClipboardAsHtmlAndText(formatted.html, formatted.text);
      setCopiedGroupEmail(true);
      cards.forEach(c => onMarkUsed(c.id));
      setTimeout(() => setCopiedGroupEmail(false), 2000);
    } catch (err) {
      console.error('Failed to copy group email', err);
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

  const handleCopySingleEmail = async (card: VoucherCard) => {
    const formatted = formatSingleForEmail(card);
    try {
       await copyToClipboardAsHtmlAndText(formatted.html, formatted.text);
      setCopiedIndividualEmail(prev => ({ ...prev, [card.id]: true }));
      onMarkUsed(card.id);
      setTimeout(() => setCopiedIndividualEmail(prev => ({ ...prev, [card.id]: false })), 2000);
    } catch (err) {
      console.error('Failed to copy single email', err);
    }
  };

  const downloadReceipt = async (card: VoucherCard) => {
    setDownloadState({ card, progress: 10, stage: 'Preparing canvas engine...' });
    await new Promise(r => setTimeout(r, 120));

    const canvas = canvasRef.current;
    if (!canvas) {
      setDownloadState(null);
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setDownloadState(null);
      return;
    }

    setDownloadState({ card, progress: 30, stage: 'Rendering receipt layout...' });
    await new Promise(r => setTimeout(r, 120));

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
      setDownloadState({ card, progress: 55, stage: 'Embedding exam body logo...' });
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

    setDownloadState({ card, progress: 75, stage: 'Drawing PIN & Serial credentials...' });
    await new Promise(r => setTimeout(r, 120));

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

    setDownloadState({ card, progress: 95, stage: 'Exporting PNG image file...' });
    await new Promise(r => setTimeout(r, 150));

    const link = document.createElement('a');
    link.download = `Receipt-${card.type}-${card.serial}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    setDownloadState({ card, progress: 100, stage: 'Download Completed!' });
    await new Promise(r => setTimeout(r, 450));
    setDownloadState(null);
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
    <div className={`bg-white rounded-2xl sm:rounded-[40px] border border-slate-200 overflow-hidden shadow-sm mb-6 sm:mb-8 transition-all hover:shadow-md border-l-[8px] sm:border-l-[12px] ${
      type === CardType.NECO ? 'border-emerald-500' : 
      type === CardType.WAEC ? 'border-yellow-500' : 
      'border-purple-500'
    }`}>
      <canvas ref={canvasRef} className="hidden" />
      
      {/* Download Progress Overlay */}
      {downloadState && (
        <DownloadProgressOverlay 
          progress={downloadState.progress} 
          stage={downloadState.stage} 
          card={downloadState.card} 
        />
      )}
      
      {/* Group Header */}
      <div className="px-4 sm:px-8 py-4 sm:py-6 bg-slate-50/50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          {logos[type] ? (
            <img src={logos[type]} className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl object-contain border bg-white p-1 shadow-sm" alt="logo" />
          ) : (
            <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-${theme}-500 flex items-center justify-center text-white shadow-lg shadow-${theme}-100`}>
              <Layers size={18} className="sm:hidden" />
              <Layers size={22} className="hidden sm:block" />
            </div>
          )}
          <div>
            <h4 className="font-black text-slate-800 tracking-tight uppercase text-sm sm:text-base">{type}s</h4>
            <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest">{cards.length} items queued</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3 w-full sm:w-auto">
           <button 
             onClick={handleCopyGroup}
             className={`flex-1 sm:flex-none justify-center px-3 sm:px-4 py-2 rounded-xl sm:rounded-2xl text-[10px] sm:text-[11px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
               copiedGroup ? 'bg-green-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
             }`}
             title="Copy for WhatsApp (with markdown bolding)"
           >
             {copiedGroup ? <CheckCircle2 size={14} /> : <Copy size={14} />}
             {copiedGroup ? 'WA Copied' : 'WhatsApp'}
           </button>
           <button 
             onClick={handleCopyGroupEmail}
             className={`flex-1 sm:flex-none justify-center px-3 sm:px-4 py-2 rounded-xl sm:rounded-2xl text-[10px] sm:text-[11px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
               copiedGroupEmail ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
             }`}
             title="Copy for Email (plain text without asterisks)"
           >
             {copiedGroupEmail ? <CheckCircle2 size={14} /> : <Mail size={14} />}
             {copiedGroupEmail ? 'Email Copied' : 'Email'}
           </button>
           <button 
             onClick={handleSendGroup}
             className="w-full sm:w-auto justify-center px-3 sm:px-4 py-2 rounded-xl sm:rounded-2xl text-[10px] sm:text-[11px] font-black uppercase tracking-widest bg-green-600 text-white hover:bg-green-700 transition-all flex items-center gap-1.5 shadow-lg shadow-green-100"
           >
             <Send size={14} />
             Send WhatsApp
           </button>
        </div>
      </div>

      {/* Group Items */}
      <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
        {cards.map((card, idx) => (
          <div key={card.id} className="p-4 sm:p-6 bg-slate-50/50 rounded-2xl sm:rounded-[28px] border border-slate-100 group hover:border-slate-200 transition-all">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 sm:gap-6">
              
              <div className="flex items-start sm:items-center gap-3 sm:gap-5 flex-1 w-full min-w-0">
                 <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] sm:text-[11px] font-black text-slate-400 shrink-0 shadow-sm mt-0.5 sm:mt-0">
                   {idx + 1}
                 </div>
                 <div className="space-y-2 sm:space-y-3 w-full min-w-0 overflow-hidden">
                    <div className="flex flex-col min-w-0">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5 sm:mb-1">{card.type} PIN</span>
                      <div className={`font-mono text-base sm:text-xl font-black tracking-wider sm:tracking-widest transition-all break-all ${card.status === 'used' ? 'text-slate-300 line-through' : 'text-slate-900'}`}>
                        {card.pin}
                      </div>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5 sm:mb-1">Serial No.</span>
                      <div className="font-mono text-xs sm:text-sm font-bold text-slate-500 tracking-wider break-all">
                        {card.serial}
                      </div>
                    </div>
                 </div>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 md:flex md:items-center gap-2 sm:gap-3 w-full md:w-auto pt-3 sm:pt-4 md:pt-0 border-t md:border-t-0 border-slate-200/60">
                 <button 
                   onClick={() => handleCopySingle(card)}
                   className={`flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl text-[11px] sm:text-xs font-black uppercase tracking-wider sm:tracking-widest transition-all ${
                     copiedIndividual[card.id] ? 'bg-green-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                   }`}
                   title="Copy for WhatsApp (with markdown bolding)"
                 >
                   {copiedIndividual[card.id] ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                   <span>WhatsApp</span>
                 </button>
                 <button 
                   onClick={() => handleCopySingleEmail(card)}
                   className={`flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl text-[11px] sm:text-xs font-black uppercase tracking-wider sm:tracking-widest transition-all ${
                     copiedIndividualEmail[card.id] ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                   }`}
                   title="Copy for Email (plain text without asterisks)"
                 >
                   {copiedIndividualEmail[card.id] ? <CheckCircle2 size={15} /> : <Mail size={15} />}
                   <span>Email</span>
                 </button>
                 <button 
                   onClick={() => downloadReceipt(card)}
                   className="flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 transition-all text-[11px] sm:text-xs font-black uppercase tracking-wider sm:tracking-widest"
                   title="Download Image Receipt"
                 >
                   <ImageIcon size={15} />
                   <span>Receipt</span>
                 </button>
                 <button 
                   onClick={() => onDelete(card.id)}
                   className="flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl bg-red-50 text-red-500 border border-red-100 hover:bg-red-100 transition-all text-[11px] sm:text-xs font-black uppercase tracking-wider sm:tracking-widest"
                   title="Delete Voucher"
                 >
                   <Trash2 size={15} />
                   <span>Delete</span>
                 </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* Group Footer Actions */}
      <div className="px-4 sm:px-8 py-3 sm:py-4 bg-slate-50/30 border-t border-slate-100 flex justify-between items-center">
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
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-green-600 rounded-xl flex items-center justify-center text-white shadow-xl shadow-green-100 transition-transform hover:scale-105 shrink-0">
              <Smartphone size={20} className="sm:hidden" />
              <Smartphone size={24} className="hidden sm:block" />
            </div>
            <div className="block">
              <h1 className="text-base sm:text-xl font-black text-slate-800 leading-none">PinFormatter</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                {isOnline ? (
                  <span className="flex items-center gap-1 text-[8px] sm:text-[9px] font-bold text-green-500 uppercase tracking-widest"><Wifi size={10} /> Live</span>
                ) : (
                  <span className="flex items-center gap-1 text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase tracking-widest"><WifiOff size={10} /> Offline</span>
                )}
              </div>
            </div>
          </div>
          
          <nav className="flex bg-slate-100 p-1 rounded-2xl shrink-0">
            <button
              onClick={() => setView('generator')}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-6 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-black transition-all ${
                view === 'generator' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <LayoutDashboard size={16} />
              <span className="hidden sm:inline">Generator</span>
            </button>
            <button
              onClick={() => setView('history')}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-6 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-black transition-all ${
                view === 'history' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <History size={16} />
              <span className="hidden sm:inline">History</span>
            </button>
          </nav>

          <div className="flex items-center gap-1 sm:gap-3 shrink-0">
             <button 
              onClick={() => setShowCalculator(true)}
              className="p-2 sm:p-2.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-xl transition-all"
              title="Calculator"
             >
               <Calculator size={18} />
             </button>
             <button 
              onClick={() => setShowBranding(true)}
              className="p-2 sm:p-2.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl transition-all"
              title="Branding"
             >
               <ImageIcon size={18} />
             </button>
             <input type="file" accept=".txt,.csv" ref={fileInputRef} onChange={handleBulkImport} className="hidden" />
             <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-2 sm:p-2.5 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              title="Import"
             >
               <Upload size={18} />
             </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-3 sm:p-6 md:p-10 grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10">
        {view === 'generator' ? (
          <>
            <div className="bg-white rounded-3xl sm:rounded-[40px] shadow-sm border border-slate-200 overflow-hidden flex flex-col h-fit transition-all hover:shadow-md">
              <div className="p-4 sm:p-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h3 className="font-black text-slate-800 flex items-center gap-2 sm:gap-3 text-sm sm:text-base">
                  <Settings size={18} className="text-green-600" />
                  Entry Box
                </h3>
                <button onClick={clearAll} className="text-[10px] text-slate-400 hover:text-red-500 font-black flex items-center gap-1.5 transition-colors uppercase tracking-widest">
                  <RefreshCw size={12} /> Reset all
                </button>
              </div>
              <div className="p-4 sm:p-8 relative flex flex-col gap-4 sm:gap-6">
                <textarea
                  className="w-full h-64 sm:h-96 p-4 sm:p-8 bg-slate-50 rounded-2xl sm:rounded-[32px] border border-slate-200 focus:border-green-500 focus:ring-8 focus:ring-green-500/5 transition-all outline-none resize-none font-mono text-xs sm:text-sm text-slate-700 placeholder:text-slate-300"
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
                  className={`w-full py-4 sm:py-6 rounded-2xl sm:rounded-[24px] font-black text-white transition-all shadow-xl flex items-center justify-center gap-3 sm:gap-4 text-base sm:text-lg
                    ${isProcessing ? 'bg-purple-400 cursor-wait' : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:scale-[1.01] active:scale-[0.99] shadow-purple-200'}
                    ${(!process.env.API_KEY || !isOnline) ? 'opacity-50 grayscale' : ''}
                  `}
                >
                  {isProcessing ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  ) : (
                    <Wand2 size={20} />
                  )}
                  {isProcessing ? 'Processing...' : 'AI Smart Extract'}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4 sm:gap-6">
              <div className="flex justify-between items-center px-2 sm:px-4">
                <h3 className="font-black text-slate-800 flex items-center gap-2 sm:gap-3 text-sm sm:text-base">
                  <LayoutDashboard size={18} className="text-green-600" />
                  Live Queue ({totalInQueue})
                </h3>
              </div>
              
              <div className="overflow-y-auto max-h-[850px] pr-1 sm:pr-2 space-y-4">
                {totalInQueue === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 sm:py-32 text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-3xl sm:rounded-[48px] px-4">
                    <div className="w-16 h-16 sm:w-24 sm:h-24 bg-slate-50 rounded-2xl sm:rounded-[40px] flex items-center justify-center mb-4 sm:mb-6">
                      <ImageIcon size={32} className="opacity-10 text-slate-900 sm:hidden" />
                      <ImageIcon size={48} className="opacity-10 text-slate-900 hidden sm:block" />
                    </div>
                    <p className="text-base sm:text-xl font-black text-slate-300 uppercase tracking-widest text-center">Queue empty</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1 text-center">Ready for input...</p>
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
            <div className="bg-white rounded-3xl sm:rounded-[48px] shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-5 sm:p-10 border-b border-slate-100 flex flex-wrap justify-between items-center bg-slate-50/30 gap-4 sm:gap-6">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight">Sales History</h2>
                  <p className="text-xs sm:text-sm text-slate-500 font-bold uppercase tracking-widest mt-0.5 sm:mt-1">Stored locally in your browser</p>
                </div>
                {history.length > 0 && (
                  <button 
                    onClick={clearHistory}
                    className="flex items-center gap-2 px-4 sm:px-8 py-2.5 sm:py-4 rounded-xl sm:rounded-2xl text-xs font-black text-red-600 hover:bg-red-50 border border-red-100 transition-all uppercase tracking-widest"
                  >
                    <Trash2 size={16} />
                    Wipe database
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                {history.length === 0 ? (
                  <div className="py-20 sm:py-40 text-center px-4">
                    <History size={60} className="mx-auto text-slate-200 mb-6 sm:mb-8" />
                    <p className="text-xl sm:text-2xl font-black text-slate-300 uppercase tracking-[0.2em]">Zero Records</p>
                  </div>
                ) : (
                  <table className="w-full min-w-[600px] text-left border-collapse">
                    <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase font-black tracking-widest">
                      <tr>
                        <th className="px-4 sm:px-10 py-4 sm:py-6">Identity</th>
                        <th className="px-4 sm:px-10 py-4 sm:py-6">Pin / SN</th>
                        <th className="px-4 sm:px-10 py-4 sm:py-6">Timestamp</th>
                        <th className="px-4 sm:px-10 py-4 sm:py-6 text-right">Delete</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {history.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-4 sm:px-10 py-4 sm:py-8">
                            <div className="flex items-center gap-2 sm:gap-3">
                              {logos[item.type] && (
                                <img src={logos[item.type]} className="w-5 h-5 sm:w-6 sm:h-6 rounded object-contain border border-slate-100" alt="sm" />
                              )}
                              <span className={`px-2.5 sm:px-4 py-1 rounded-xl text-[9px] sm:text-[10px] font-black uppercase border ${
                                item.type === CardType.WAEC ? 'bg-yellow-50 text-yellow-700 border-yellow-100' :
                                item.type === CardType.NECO ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                'bg-purple-50 text-purple-700 border-purple-100'
                              }`}>
                                {item.type}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 sm:px-10 py-4 sm:py-8">
                            <div className="font-mono">
                              <div className="font-black text-slate-800 text-sm sm:text-base break-all">{item.pin}</div>
                              <div className="text-[10px] sm:text-xs text-slate-400 font-bold uppercase mt-0.5 break-all">{item.serial}</div>
                            </div>
                          </td>
                          <td className="px-4 sm:px-10 py-4 sm:py-8">
                            <div className="text-[11px] sm:text-xs text-slate-500 flex items-center gap-1.5 font-bold uppercase tracking-wider">
                              <Clock size={12} className="text-slate-300 shrink-0" />
                              {item.sentAt ? new Date(item.sentAt).toLocaleString() : 'N/A'}
                            </div>
                          </td>
                          <td className="px-4 sm:px-10 py-4 sm:py-8 text-right">
                            <button 
                              onClick={() => deleteHistoryItem(item.id)}
                              className="text-slate-300 hover:text-red-500 p-2 sm:p-3 rounded-xl sm:rounded-2xl hover:bg-red-50 transition-all"
                            >
                              <Trash2 size={18} />
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

      <footer className="md:hidden bg-white border-t border-slate-200 h-16 flex items-center justify-around sticky bottom-0 z-30 px-4 shadow-2xl">
        <button onClick={() => setView('generator')} className={`flex flex-col items-center gap-1 transition-all ${view === 'generator' ? 'text-green-600 scale-105' : 'text-slate-400'}`}>
          <LayoutDashboard size={20} />
          <span className="text-[9px] font-black uppercase tracking-widest">Queue</span>
        </button>
        <button onClick={() => setShowCalculator(true)} className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center text-white shadow-xl shadow-green-200 -mt-6 border-4 border-white transition-transform active:scale-95">
          <Calculator size={22} />
        </button>
        <button onClick={() => setView('history')} className={`flex flex-col items-center gap-1 transition-all ${view === 'history' ? 'text-green-600 scale-105' : 'text-slate-400'}`}>
          <History size={20} />
          <span className="text-[9px] font-black uppercase tracking-widest">Logs</span>
        </button>
      </footer>

      {showBranding && <BrandingModal logos={logos} onUpdate={setLogos} onClose={() => setShowBranding(false)} />}
      {showCalculator && <PriceCalculatorModal onClose={() => setShowCalculator(false)} />}
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
