import { useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { X, Camera } from 'lucide-react';

interface ScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
}

export const Scanner = ({ onScan, onClose }: ScannerProps) => {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    scannerRef.current = new Html5QrcodeScanner(
      'reader',
      { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
      },
      false
    );

    scannerRef.current.render(
      (decodedText) => {
        if (scannerRef.current) {
          scannerRef.current.clear().catch(console.error);
        }
        onScan(decodedText);
      },
      (error) => {
        if (typeof error === 'string' && !error.includes('NotFoundException')) {
          console.warn(error);
        }
      }
    );

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center animate-in fade-in duration-500">
      {/* Cinematic Header */}
      <div className="w-full p-8 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 glass rounded-xl flex items-center justify-center">
            <Camera size={20} className="text-neon-cyan" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight uppercase">Pairing</h2>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse" />
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Live Camera Active</span>
            </div>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-3 glass rounded-full hover:bg-white/10 transition-colors"
        >
          <X size={20} className="text-white" />
        </button>
      </div>

      <div className="flex-1 w-full flex flex-col items-center justify-center px-8 space-y-12">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-black tracking-tight">Link Workstation</h1>
          <p className="text-white/40 max-w-[240px] mx-auto text-sm">Align the QR code on your desktop app with the scanner frame below.</p>
        </div>

        <div className="relative aspect-square w-full max-w-sm rounded-[48px] overflow-hidden border border-white/10 shadow-2xl">
          <div id="reader" className="w-full h-full"></div>
          
          {/* Custom Overlay */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            {/* Corner Brackets */}
            <div className="w-[260px] h-[260px] relative">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-neon-cyan rounded-tl-2xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-neon-cyan rounded-tr-2xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-neon-cyan rounded-bl-2xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-neon-cyan rounded-br-2xl" />
              
              {/* Scan Line */}
              <div className="absolute top-0 left-0 w-full h-0.5 bg-neon-cyan shadow-[0_0_15px_#00f3ff] animate-scan opacity-60"></div>
            </div>
            
            {/* Vignette */}
            <div className="absolute inset-0 bg-black/20" />
          </div>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="px-6 py-2 glass rounded-full">
            <p className="text-[10px] font-black text-white/60 uppercase tracking-[0.3em]">Hardware Encrypted Channel</p>
          </div>
        </div>
      </div>

      <style>{`
        #reader { border: none !important; }
        #reader__dashboard_section_csr button {
          display: none !important;
        }
        #reader__scan_region video {
          object-fit: cover !important;
          border-radius: 0 !important;
        }
        @keyframes scan {
          0% { transform: translateY(0); }
          100% { transform: translateY(260px); }
        }
        .animate-scan {
          animation: scan 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};
