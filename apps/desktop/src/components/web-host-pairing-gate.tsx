import { useState } from "react";
import { useTranslation } from "react-i18next";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DesktopFormInput } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";
import { showDesktopErrorToast } from "@/lib/desktop-error-toast";

export function WebHostPairingGate({
  busy,
  onPair,
}: {
  busy: boolean;
  onPair(code: string): Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");

  const submit = () => {
    const normalized = code.trim();
    if (!normalized) {
      showDesktopErrorToast(t("app.enterPairingCode"), "web-host-pairing-local");
      return;
    }
    void onPair(normalized).then((ok) => {
      if (!ok) {
        showDesktopErrorToast(t("app.pairingFailed"), "web-host-pairing-local");
      }
    });
  };

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-sm rounded-lg">
        <CardHeader>
          <CardTitle>{t('app.firstTimePairing')}</CardTitle>
          <CardDescription>{t('app.pairingDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="web-host-pairing-code">{t('app.pairingCode')}</Label>
            <DesktopFormInput
              id="web-host-pairing-code"
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              onChange={(event) => {
                setCode(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !busy) {
                  submit();
                }
              }}
            />
          </div>
          <Button type="button" className="w-full" disabled={busy} onClick={submit}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {t('app.pair')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
