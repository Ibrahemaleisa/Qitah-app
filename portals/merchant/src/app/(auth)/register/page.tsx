import type { Metadata } from "next";

import { RegisterWizard } from "./RegisterWizard";

export const metadata: Metadata = { title: "تسجيل متجر جديد" };

export default function RegisterPage() {
  return <RegisterWizard />;
}
