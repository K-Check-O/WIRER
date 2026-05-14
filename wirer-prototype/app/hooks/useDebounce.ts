'use client';

import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // delayミリ秒後にvalueでdebouncedValueを更新するタイマーを設定
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // 次のeffectが実行される前、またはアンマウント時にタイマーをクリア
    return () => clearTimeout(handler);
  }, [value, delay]); // valueかdelayが変わった時だけeffectを再実行

  return debouncedValue;
}