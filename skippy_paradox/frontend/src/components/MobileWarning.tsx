import React from 'react';
import { useTheme } from '../hooks/useTheme';
import { VERSION } from '../constants';
import { Layout } from 'lucide-react';

export const MobileWarning: React.FC = () => {
  const { isDark } = useTheme();

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-[#0b1120]' : 'bg-slate-50'}`}>
      <div className="max-w-sm w-full">
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="bg-blue-600 p-1.5 rounded-md">
              <Layout size={14} className="text-white" />
            </div>
            <h1 className={`text-lg font-bold tracking-tight quantico-font ${isDark ? 'text-white' : 'text-slate-900'}`}>
              Skiffy <span className="text-blue-500 text-[10px] font-mono font-normal ml-0.5 opacity-70">// v{VERSION}</span>
            </h1>
          </div>
        </div>

        <div className={`rounded-lg p-5 border ${isDark ? 'bg-slate-800/50 border-slate-800' : 'bg-white border-slate-200'}`}>
          <h2 className={`text-lg font-bold text-center mb-3 ${isDark ? 'text-white' : 'text-slate-900'}`}>
            Desktop Experience Required
          </h2>

          <p className={`text-center text-sm mb-4 leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
            Skiffy's code editor interface requires a larger screen for the best experience.
            The editor workflow is optimized for desktop use.
          </p>

          <div className={`rounded-lg p-3 mb-4 border ${isDark ? 'bg-blue-900/30 border-blue-800/50' : 'bg-blue-50 border-blue-200'}`}>
            <p className={`text-xs text-center ${isDark ? 'text-blue-200' : 'text-blue-700'}`}>
              <strong className={isDark ? 'text-blue-100' : 'text-blue-800'}>Mobile design is under development</strong> and will be available soon.
            </p>
          </div>

          <div className={`border-t pt-4 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
            <p className={`text-xs text-center leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Please open this page on a <strong className={isDark ? 'text-white' : 'text-slate-900'}>desktop or laptop computer</strong> with a screen width of at least <strong className={isDark ? 'text-white' : 'text-slate-900'}>1024px</strong>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
