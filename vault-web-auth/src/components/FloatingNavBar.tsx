import React from 'react';
import { Lock, Smartphone, Activity, Shield, Settings } from 'lucide-react';

interface FloatingNavBarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const tabs = [
  { id: 'vault', label: 'Vault', icon: Lock },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'shield', label: 'Shield', icon: Shield },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const FloatingNavBar: React.FC<FloatingNavBarProps> = ({ activeTab, setActiveTab }) => {
  return (
    <div className="fixed bottom-6 left-0 right-0 flex justify-center px-4 z-50">
      <div className="glass rounded-full px-2 py-2 flex items-center gap-1 shadow-2xl relative overflow-hidden">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex flex-col items-center justify-center min-w-[64px] py-1 transition-all duration-300 z-10 ${
                isActive ? 'text-neon-cyan' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <Icon size={20} className={isActive ? 'drop-shadow-[0_0_8px_rgba(0,243,255,0.5)]' : ''} />
              <span className="text-[10px] mt-1 font-medium tracking-tight">{tab.label}</span>
              
              {isActive && (
                <div className="absolute -bottom-1 w-1 h-1 bg-neon-cyan rounded-full shadow-[0_0_8px_rgba(0,243,255,0.8)]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
