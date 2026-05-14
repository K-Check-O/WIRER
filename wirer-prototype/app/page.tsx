"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useDebounce } from './hooks/useDebounce';

// --- 型定義 ---
interface WireMessage {
  text: string;
  sender: string;
  timestamp: number;
}

export default function WirerApp() {
  // --- State定義 ---
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [identityRoute, setIdentityRoute] = useState<'archive' | 'ghost'>('archive');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [myWireId, setMyWireId] = useState('');
  const [inputText, setInputText] = useState('');
  const [integrity, setIntegrity] = useState<number | null>(null);
  const [messages, setMessages] = useState<WireMessage[]>([]);
  const [wirerModule, setWirerModule] = useState<any>(null);

  // --- Refs ---
  const gunRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const debouncedInput = useDebounce(inputText, 300);

  // --- 定数 ---
  const NOISE_THRESHOLD = 50; 

  // --- 🛡️ 暗号・ユーティリティヘルパー ---
  const sha256 = async (text: string): Promise<string> => {
    const msgUint8 = new TextEncoder().encode(text);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const xorCipher = (text: string, key: string): string => {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(result);
  };

  const xorDecipher = (encodedText: string, key: string): string => {
    const text = atob(encodedText);
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  };

  // --- 🌐 模擬DB通信 (Web 2.5) ---
  const mockServerBackup = (userEmail: string, authHash: string, encryptedBlock: string, wireId: string) => {
    const serverDb = JSON.parse(localStorage.getItem('WIRER_SERVER_DB') || '{}');
    serverDb[userEmail.toLowerCase().trim()] = { authHash, encryptedBlock, wireId };
    localStorage.setItem('WIRER_SERVER_DB', JSON.stringify(serverDb));
  };

  const mockServerFetch = (userEmail: string) => {
    const serverDb = JSON.parse(localStorage.getItem('WIRER_SERVER_DB') || '{}');
    return serverDb[userEmail.toLowerCase().trim()] || null;
  };

  // --- ⚙️ アプリ初期化 ---
  const initGuestIdentity = () => {
    let guestId = sessionStorage.getItem('wirer_guest_id');
    if (!guestId) {
      const array = new Uint8Array(4);
      window.crypto.getRandomValues(array);
      const hex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      // ゲストも WIRE-XXXX-XXXX 形式に合わせる（例: WIRE-0000-XXXX）
      guestId = `WIRE-0000-${hex}`;
      sessionStorage.setItem('wirer_guest_id', guestId);
    }
    setMyWireId(guestId);
  };

  useEffect(() => {
    const initApp = async () => {
      initGuestIdentity();

      const win = window as any;
      if (win.createWirerCore) {
        const module = await win.createWirerCore();
        setWirerModule(module);
      }

      const Gun = (await import('gun' as any)).default;
      const gun = Gun({ peers: ['http://localhost:8765/gun'] });
      gunRef.current = gun;

      gun.get('wirer-proto-local-hub').get('chat').map().on((data: any) => {
        if (data && data.text && data.sender) {
          setMessages((prev) => {
            const isDuplicate = prev.some(m => m.timestamp === data.timestamp && m.sender === data.sender);
            if (isDuplicate) return prev;
            return [...prev, data].sort((a, b) => a.timestamp - b.timestamp);
          });
        }
      });
    };
    initApp();
  }, []);

  // --- 🧠 C++ (Wasm) 判定 ---
  useEffect(() => {
    if (wirerModule && debouncedInput) {
      const result = wirerModule.ccall('check_signal_integrity', 'number', ['string'], [debouncedInput]);
      setIntegrity(result);
    } else if (!debouncedInput) {
      setIntegrity(null);
    }
  }, [debouncedInput, wirerModule]);

  // --- 🔐 認証処理 (WIRE-XXXX-XXXX 形式の生成) ---
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    const emailKey = email.toLowerCase().trim();
    const authHash = await sha256(`AUTH:${emailKey}:${password}`);
    const encryptionKey = await sha256(`ENC:${emailKey}:${password}`);

    if (identityRoute === 'ghost') {
      const idHex = (await sha256(`GHOST:${encryptionKey}`)).toUpperCase();
      // 新フォーマット: WIRE-XXXX-XXXX
      const generatedId = `WIRE-${idHex.slice(0, 4)}-${idHex.slice(4, 8)}`;
      setMyWireId(generatedId);
      setIsLoggedIn(true);
      setShowAuthForm(false);
      alert(`GHOST MODE: サーバー非依存ID [${generatedId}] を生成しました。`);
    } else {
      const serverData = mockServerFetch(emailKey);
      if (serverData) {
        if (serverData.authHash !== authHash) {
          alert("📡 認証エラー: 資格情報が一致しません。");
          return;
        }
        try {
          const decryptedMaster = xorDecipher(serverData.encryptedBlock, encryptionKey);
          if (!decryptedMaster.startsWith('WIRER_SOUL:')) throw new Error();
          setMyWireId(serverData.wireId);
          setIsLoggedIn(true);
          setShowAuthForm(false);
          alert(`ARCHIVE MODE: ID [${serverData.wireId}] を復元しました。`);
        } catch {
          alert("⚡ 回路切断: データの復号に失敗しました。");
        }
      } else {
        if (confirm("新規IDを発行し、運営に暗号化バックアップを保存しますか？")) {
          const array = new Uint8Array(8);
          window.crypto.getRandomValues(array);
          const randHex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
          const masterKey = `WIRER_SOUL:${randHex}`;
          
          const idHex = (await sha256(masterKey)).toUpperCase();
          // 新フォーマット: WIRE-XXXX-XXXX
          const wireId = `WIRE-${idHex.slice(0, 4)}-${idHex.slice(4, 8)}`;
          const encryptedBlock = xorCipher(masterKey, encryptionKey);

          mockServerBackup(emailKey, authHash, encryptedBlock, wireId);
          setMyWireId(wireId);
          setIsLoggedIn(true);
          setShowAuthForm(false);
          alert(`ARCHIVE MODE: 新規ID [${wireId}] を発行・保存しました。`);
        }
      }
    }
  };

  // --- 🚀 送信処理 ---
  const sendMessage = () => {
    if (!inputText.trim() || !myWireId || !gunRef.current) return;

    if (integrity !== null && integrity < NOISE_THRESHOLD) {
      alert("ノイズが多すぎるため、送信回路が絶縁されました。");
      return;
    }

    gunRef.current.get('wirer-proto-local-hub').get('chat').set({
      text: inputText,
      sender: myWireId,
      timestamp: Date.now()
    });

    setInputText('');
    setIntegrity(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col min-h-screen bg-black text-white p-6 font-mono justify-between">
      <div className="w-full max-w-lg mx-auto space-y-4">
        
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-[0.3em]">W I R E R</h1>
          <p className="text-[10px] text-zinc-500 tracking-widest uppercase">Engineering & Minimalist Communication</p>
        </header>

        {/* 状態モニター */}
        <div className="border border-zinc-800 p-3 bg-zinc-950 flex justify-between items-center text-xs">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isLoggedIn ? 'bg-emerald-500' : 'bg-zinc-600'}`}></span>
            <span className="text-zinc-500 uppercase tracking-widest text-[10px]">
              {isLoggedIn ? `Secured (${identityRoute.toUpperCase()})` : 'Guest Mode'}
            </span>
          </div>
          <button 
            onClick={() => isLoggedIn ? (setIsLoggedIn(false), initGuestIdentity()) : setShowAuthForm(!showAuthForm)}
            className="text-zinc-400 hover:text-white underline text-[10px] uppercase"
          >
            {isLoggedIn ? 'Disconnect' : showAuthForm ? 'Close' : 'Sync Account'}
          </button>
        </div>

        {/* 認証フォーム */}
        {showAuthForm && !isLoggedIn && (
          <form onSubmit={handleAuthSubmit} className="border border-zinc-800 p-4 bg-zinc-950 text-xs space-y-4 animate-fade-in">
            <div className="space-y-1">
              <label className="text-zinc-500 uppercase text-[9px] tracking-widest block">Identity Route</label>
              <div className="grid grid-cols-2 gap-2 border border-zinc-800 p-1 bg-zinc-900/50">
                <button type="button" onClick={() => setIdentityRoute('archive')}
                  className={`py-1.5 uppercase font-bold text-[10px] transition-colors ${identityRoute === 'archive' ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                  Archive (推奨)
                </button>
                <button type="button" onClick={() => setIdentityRoute('ghost')}
                  className={`py-1.5 uppercase font-bold text-[10px] transition-colors ${identityRoute === 'ghost' ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                  Ghost (完全分散)
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-zinc-500 uppercase text-[9px]">Email</label>
              <input type="email" required placeholder="example@wire.com" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500" />
            </div>
            <div className="space-y-1">
              <label className="text-zinc-500 uppercase text-[9px]">Password</label>
              <input type="password" required placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 p-2 text-white focus:outline-none focus:border-zinc-500" />
            </div>
            <button type="submit" className="w-full py-2 bg-white text-black font-bold uppercase text-[10px] tracking-widest">Establish Identity</button>
          </form>
        )}

        <div className="text-right text-[10px] text-zinc-500 tracking-widest uppercase">
          Current ID: <span className="text-zinc-200 font-bold tracking-normal">{myWireId}</span>
        </div>

        {/* ログエリア */}
        <div className="border border-zinc-800 p-4 h-48 overflow-y-auto space-y-3 bg-zinc-950">
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Incoming Wires</p>
          {messages.length === 0 ? (
            <p className="text-zinc-700 text-sm text-center pt-8 italic">Awaiting signal...</p>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className="text-sm p-2 border-l border-zinc-800 bg-zinc-900/20">
                <span className={`text-[9px] block uppercase tracking-wider mb-1 ${msg.sender === myWireId ? 'text-emerald-500' : 'text-zinc-500'}`}>
                  {msg.sender === myWireId ? 'You' : msg.sender}
                </span>
                <span className="text-zinc-200">{msg.text}</span>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 整合性モニター */}
        <div className="border border-zinc-800 p-4 bg-zinc-950 text-center relative">
          <span className="text-[10px] text-zinc-600 absolute top-2 left-4 tracking-tighter">SIGNAL INTEGRITY</span>
          <div className={`text-3xl font-bold mt-1 ${integrity !== null && integrity < NOISE_THRESHOLD ? 'text-red-900' : 'text-white'}`}>
            {integrity !== null ? `${integrity}%` : '--%'}
          </div>
        </div>

        {/* 入力セクション */}
        <div className="space-y-4">
          <textarea
            className="w-full h-20 bg-transparent border border-zinc-800 p-4 focus:outline-none focus:border-zinc-400 transition-colors resize-none text-base"
            placeholder="Type a wire... (Ctrl+Enter to transmit)"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button onClick={sendMessage} className="w-full py-3 bg-white text-black font-bold uppercase text-xs tracking-widest hover:bg-zinc-200 transition-colors active:scale-[0.98]">
            Transmit Signal
          </button>
        </div>
      </div>
    </div>
  );
}