'use client';

import { useEffect, useState } from 'react';

export default function Home() {
  const [wirerModule, setWirerModule] = useState<any>(null);
  const [inputText, setInputText] = useState('');
  const [integrity, setIntegrity] = useState<number | null>(null);

  // 1. WebAssemblyモジュールのロード
useEffect(() => {
  const loadWasm = async () => {
    console.log('Trying to load Wasm...'); // デバッグ：開始ログ
    try {
      // public/wasm/wirer_core.js をロード
      // @ts-ignore
      const createWirerCore = (await import('../public/wasm/wirer_core.js' as any)).default;
      console.log('createWirerCore function loaded.'); // デバッグ：JSロード成功

      // Wasmモジュールのインスタンス化
      const module = await createWirerCore({
        print: (text: string) => console.log('Wasm Log:', text),
        printErr: (text: string) => console.error('Wasm Error:', text),
      });

      console.log('Wasm Module instance created.'); // デバッグ：インスタンス化成功
      setWirerModule(module);
      console.log('WIRER Core Connected.'); // デバッグ：完全接続
    } catch (e) {
      console.error('Failed to load Wasm:', e); // デバッグ：エラーログ
    }
  };
  loadWasm();
}, []);

// テキスト入力時の処理
const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  const text = e.target.value;
  setInputText(text);

  if (wirerModule) {
    console.log('Calling check_signal_integrity with:', text); // デバッグ：呼び出し前
    // C++側の関数を呼び出し
    const result = wirerModule.ccall(
      'check_signal_integrity', // 関数名
      'number',                  // 戻り値の型
      ['string'],                // 引数の型
      [text]                     // 引数
    );
    console.log('Integrity Result from C++:', result); // デバッグ：結果ログ
    setIntegrity(result);
  } else {
    // 画面に%が出ない場合、ここを通っているはずです
    console.warn('WIRER Module is not yet loaded.'); // デバッグ：未ロード警告
  }
  };

  return (
    <div className="flex flex-col min-h-screen items-center justify-center bg-black text-white p-6 font-mono">
      <div className="w-full max-w-lg space-y-12">
        
        {/* Header */}
        <header className="text-center space-y-2">
          <h1 className="text-5xl font-bold tracking-[0.3em] text-white">WIRER</h1>
          <p className="text-[10px] text-zinc-500 tracking-widest uppercase">
            Engineering & Minimalist Communication
          </p>
        </header>

        {/* Wire-Face / Signal Monitor */}
        <div className="border border-zinc-800 p-8 bg-zinc-900/30 backdrop-blur-md relative overflow-hidden">
          <div className="flex justify-between items-center mb-6">
            <span className="text-xs text-zinc-500 tracking-tighter">SIGNAL STATUS</span>
            <div className={`px-2 py-0.5 text-[10px] border ${integrity !== null && integrity < 50 ? 'border-red-500 text-red-500 animate-pulse' : 'border-emerald-500 text-emerald-500'}`}>
              {integrity !== null && integrity < 50 ? 'NOISE DETECTED' : 'STABLE'}
            </div>
          </div>

          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="text-6xl font-bold tracking-tighter">
              {integrity !== null ? `${integrity}%` : '--%'}
            </div>
            <div className="w-full h-px bg-zinc-800 relative">
              <div 
                className={`absolute top-0 left-0 h-full transition-all duration-500 ${integrity !== null && integrity < 50 ? 'bg-red-600' : 'bg-white'}`}
                style={{ width: `${integrity ?? 0}%` }}
              />
            </div>
          </div>
          
          {/* 装飾の赤ドット（Nothingスタイル） */}
          <div className="absolute bottom-4 right-4 w-1.5 h-1.5 bg-red-600 rounded-full shadow-[0_0_8px_rgba(255,0,0,0.8)]" />
        </div>

        {/* Input Area */}
        <div className="space-y-4">
          <textarea
            className="w-full h-40 bg-transparent border-b border-zinc-800 p-4 focus:outline-none focus:border-white transition-colors resize-none text-lg leading-relaxed placeholder:text-zinc-700"
            placeholder="Type your message here..."
            value={inputText}
            onChange={handleInputChange}
          />
          <div className="flex justify-between text-[10px] text-zinc-600 tracking-widest">
            <span>P2P ENCRYPTED</span>
            <span>{inputText.length} CHARS</span>
          </div>
        </div>

        {/* Wire-Face Advice */}
        <footer className="text-center h-4">
          {integrity !== null && integrity < 50 && (
            <p className="text-red-500 text-xs animate-bounce">
              Caution: Wire-Face detected emotional noise.
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}