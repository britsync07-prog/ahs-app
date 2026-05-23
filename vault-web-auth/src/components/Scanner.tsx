import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, ShieldAlert } from 'lucide-react';

interface ScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
}

export const Scanner = ({ onScan, onClose }: ScannerProps) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const startScanner = async () => {
    try {
      // Explicitly request camera permission first to ensure browser prompt appears
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      // Stop the temporary stream used for permission check
      stream.getTracks().forEach(track => track.stop());

      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 0) {
        setHasPermission(true);
        setError(null);
        
        const html5QrCode = new Html5Qrcode('reader');
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
          },
          (decodedText) => {
            html5QrCode.stop().then(() => {
              onScan(decodedText);
            }).catch(console.error);
          },
          () => {} // silent error for frame scanning
        );
      } else {
        setError('No cameras found on this device.');
      }
    } catch (err) {
      console.error('Camera start failed', err);
      setHasPermission(false);
      setError('Camera access denied. Please enable camera permissions in your settings.');
    }
  };

  useEffect(() => {
    startScanner();
    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center animate-in fade-in duration-500 overflow-hidden">
      {/* Cinematic Header */}
      <div className="w-full p-8 flex items-center justify-between z-10">
        <div className="flex items-center gap-3 text-text-primary">
          <div className="w-10 h-10 glass rounded-xl flex items-center justify-center">
            <Camera size={20} className="text-neon-cyan" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight uppercase">Pairing</h2>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse" />
              <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Live Scanner</span>
            </div>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-3 glass rounded-full hover:bg-text-secondary/10 transition-colors"
        >
          <X size={20} className="text-text-primary" />
        </button>
      </div>

      <div className="flex-1 w-full flex flex-col items-center justify-center px-8 space-y-12">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-black tracking-tight text-text-primary">Link Workstation</h1>
          <p className="text-text-secondary max-w-[240px] mx-auto text-sm">Align the QR code on your desktop app with the scanner frame below.</p>
        </div>

        <div className="relative aspect-square w-full max-w-sm rounded-[48px] overflow-hidden border border-border-subtle shadow-2xl bg-surface">
          <div id="reader" className="w-full h-full"></div>
          
          {hasPermission === false && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center space-y-4 bg-background/90 z-20">
              <ShieldAlert size={48} className="text-deep-red" />
              <p className="text-sm font-medium text-text-primary">{error}</p>
              <button 
                onClick={startScanner}
                className="px-6 py-2 bg-neon-cyan text-black font-bold rounded-full"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Custom Overlay */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
            {/* Corner Brackets */}
            <div className="w-[260px] h-[260px] relative">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-neon-cyan rounded-tl-2xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-neon-cyan rounded-tr-2xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-neon-cyan rounded-bl-2xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-neon-cyan rounded-br-2xl" />
              
              {/* Scan Line */}
              <div className="absolute top-0 left-0 w-full h-0.5 bg-neon-cyan shadow-[0_0_15px_#00f3ff] animate-scan opacity-60"></div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="px-6 py-2 glass rounded-full">
            <p className="text-[10px] font-black text-text-secondary uppercase tracking-[0.3em]">Hardware Encrypted Channel</p>
          </div>
        </div>
      </div>

      <style>{`
        #reader video {
          object-fit: cover !important;
          width: 100% !important;
          height: 100% !important;
          /* Critical for iOS Safari to allow inline playback */
          -webkit-playsinline: true;
          playsinline: true;
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
