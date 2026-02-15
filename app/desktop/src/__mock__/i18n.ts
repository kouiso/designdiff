import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ja from "../i18n/locale/ja.json";

i18n.use(initReactI18next).init({
  lng: "ja",
  resources: { ja: { translation: ja } },
  interpolation: { escapeValue: false },
});

export default i18n;
