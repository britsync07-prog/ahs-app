import React from 'react';
import { Palette, Shield, Key, Bell, Globe, ChevronRight } from 'lucide-react';

export const SettingsScreen: React.FC = () => {
  const sections = [
    {
      title: 'General',
      items: [
        { label: 'Appearance', icon: Palette, color: 'text-purple-400' },
        { label: 'Notifications', icon: Bell, color: 'text-yellow-400' },
        { label: 'Language', icon: Globe, color: 'text-blue-400' },
      ]
    },
    {
      title: 'Security',
      items: [
        { label: 'Vault Configuration', icon: Shield, color: 'text-neon-cyan' },
        { label: 'Master Recovery Key', icon: Key, color: 'text-emerald-green' },
      ]
    }
  ];

  return (
    <div className="flex-1 flex flex-col p-6 space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
      <header className="pt-4">
        <h1 className="text-3xl font-black tracking-tight">SETTINGS</h1>
        <p className="text-white/40 text-sm">Manage your security preferences.</p>
      </header>

      <div className="flex-1 space-y-8 pb-12">
        {sections.map((section) => (
          <div key={section.title} className="space-y-4">
            <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em] px-2">
              {section.title}
            </h3>
            <div className="glass-dark rounded-[32px] overflow-hidden border border-white/5">
              {section.items.map((item, index) => (
                <button 
                  key={item.label}
                  className={`w-full flex items-center justify-between p-5 hover:bg-white/5 active:bg-white/10 transition-colors ${
                    index !== section.items.length - 1 ? 'border-b border-white/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 ${item.color}`}>
                      <item.icon size={20} />
                    </div>
                    <span className="font-bold text-white/90">{item.label}</span>
                  </div>
                  <ChevronRight size={18} className="text-white/20" />
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="pt-4 space-y-4">
          <button className="w-full h-16 rounded-[28px] bg-deep-red/10 border border-deep-red/20 text-deep-red font-bold text-sm uppercase tracking-widest active:scale-[0.98] transition-all">
            Reset All Data
          </button>
          <p className="text-center text-[10px] font-bold text-white/10 uppercase tracking-[0.2em]">
            Vault Mobile Auth v1.2.0
          </p>
        </div>
      </div>
    </div>
  );
};
