import { atom, useAtom } from "../app-jotai";

export const appLangCodeAtom = atom("zh-CN");

export const useAppLangCode = () => {
  const [langCode, setLangCode] = useAtom(appLangCodeAtom);

  return [langCode, setLangCode] as const;
};
