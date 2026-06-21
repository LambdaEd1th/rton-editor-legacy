import { useEffect, useState } from 'react';
import { getAvailableLangs, getLang, getLangLabel, onLangChange, setLang, t } from './i18n';

export function useI18n() {
  const [lang, setCurrentLang] = useState(getLang);

  useEffect(() => onLangChange(setCurrentLang), []);

  return {
    lang,
    langs: getAvailableLangs(),
    getLangLabel,
    setLang,
    t,
  };
}
