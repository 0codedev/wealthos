import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { TabHeader } from "@/components/ui/TabHeader";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { useSettingsStore, DesignPreset } from "@/store/settingsStore";
import { Sparkles, Check, Sliders, ShieldCheck, Activity, RefreshCw, CheckCircle2, AlertCircle, Palette } from "lucide-react";
import { UnifiedAlert } from "@/components/ui/UnifiedAlert";
import { UnifiedButton } from "@/components/ui/UnifiedButton";

export const ComponentWorkshop: React.FC = () => {
  const currentPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";
  const currentTheme = useSettingsStore((s) => s.activeTheme) || "default";
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  const themeList = [
    { id: "default", name: "Default Slate", color: "#6366f1" },
    { id: "grey-dark", name: "TradeDiary Grey", color: "#f59e0b" },
    { id: "aurora", name: "Aurora Violet", color: "#a855f7" },
    { id: "obsidian", name: "Obsidian Nova", color: "#8b5cf6" },
  ];

  const [isLoading, setIsLoading] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);
  const [sliderVal, setSliderVal] = useState<number>(42);

  // Typography Test Controls
  const [tabWeight, setTabWeight] = useState<number>(700);
  const [tabSize, setTabSize] = useState<number>(24);

  const handleApplyWeight = (w: number) => {
    setTabWeight(w);
    document.documentElement.style.setProperty("--weight-tab-title", `${w}`);
  };

  const handleApplySize = (s: number) => {
    setTabSize(s);
    document.documentElement.style.setProperty("--size-tab-title", `${s}px`);
  };

  const presets: { id: DesignPreset; name: string; tag: string; desc: string }[] = [
    {
      id: "wealthos-classic",
      name: "WealthOS Classic",
      tag: "Default (100% Preserved)",
      desc: "Original indigo brand palette, 8px rounded controls, familiar baseline.",
    },
    {
      id: "reui-nova",
      name: "ReUI Obsidian-Nova",
      tag: "1,105 MIT Primitives",
      desc: "Deep obsidian canvas, frosted specular highlight, violet accents.",
    },
    {
      id: "astryx",
      name: "Meta Astryx",
      tag: "Meta Open Source (150+ Components)",
      desc: "StyleX-backed tokens, solid white primary button, 4px tight radius.",
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 text-slate-100">
      {/* Top Global Controls Strip */}
      <div className="bg-[#0D0E14] border border-white/10 rounded-xl p-5 shadow-2xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              <h2 className="text-xl font-bold tracking-tight text-white">
                Component Workshop (Storybook Workbench)
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Live side-by-side verification of all 3 component library verticals with real-time controls.
            </p>
          </div>

          {/* Interactive State Toggles */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <Button
              variant={isLoading ? "default" : "outline"}
              size="sm"
              onClick={() => setIsLoading(!isLoading)}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
              Toggle Loading
            </Button>
            <Button
              variant={isDisabled ? "destructive" : "outline"}
              size="sm"
              onClick={() => setIsDisabled(!isDisabled)}
            >
              Toggle Disabled
            </Button>
          </div>
        </div>

        {/* Real-Time Typography Slider Controls */}
        <div className="pt-3 border-t border-white/[0.06] grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-300 font-mono">
              <span>Top-Down Header Font Weight:</span>
              <span className="text-indigo-400 font-bold">{tabWeight}</span>
            </div>
            <div className="flex gap-2">
              {[500, 600, 700, 800, 900].map((w) => (
                <button
                  key={w}
                  onClick={() => handleApplyWeight(w)}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                    tabWeight === w
                      ? "bg-indigo-600 border-indigo-500 text-white font-bold"
                      : "bg-black/30 border-white/10 text-slate-400 hover:text-white"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-300 font-mono">
              <span>Top-Down Header Font Size:</span>
              <span className="text-indigo-400 font-bold">{tabSize}px</span>
            </div>
            <div className="flex gap-2">
              {[20, 22, 24, 28, 32].map((s) => (
                <button
                  key={s}
                  onClick={() => handleApplySize(s)}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                    tabSize === s
                      ? "bg-indigo-600 border-indigo-500 text-white font-bold"
                      : "bg-black/30 border-white/10 text-slate-400 hover:text-white"
                  }`}
                >
                  {s}px
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Theme Studio Strip */}
        <div className="pt-3 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-semibold text-white">Layer 1: Theme Studio Skin:</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {themeList.map((t) => (
              <button
                key={t.id}
                onClick={() => updateSetting("activeTheme", t.id as any)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-all flex items-center gap-1.5 ${
                  currentTheme === t.id
                    ? "bg-white/15 border-indigo-400 text-white font-bold shadow-[0_0_12px_rgba(99,102,241,0.25)]"
                    : "bg-black/30 border-white/10 text-slate-400 hover:text-white"
                }`}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
                {t.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3-Column Comparative Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {presets.map((preset) => {
          const isCurrent = currentPreset === preset.id;

          return (
            <div
              key={preset.id}
              data-design-preset={preset.id}
              data-astryx-theme={preset.id === "astryx" ? "neutral" : undefined}
              className={`rounded-2xl p-5 border transition-all flex flex-col gap-6 bg-[#08090C] relative ${
                isCurrent
                  ? "border-indigo-500/80 shadow-[0_0_24px_rgba(99,102,241,0.2)]"
                  : "border-white/10"
              }`}
            >
              {/* Header Strip of Vertical Card */}
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-base">{preset.name}</span>
                    {isCurrent && (
                      <Badge variant="live" size="sm">
                        ACTIVE
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono block mt-0.5">
                    {preset.tag}
                  </span>
                </div>

                <Button
                  size="sm"
                  variant={isCurrent ? "secondary" : "default"}
                  onClick={() => updateSetting("designPreset", preset.id as any)}
                  disabled={isCurrent}
                >
                  {isCurrent ? <Check className="w-3.5 h-3.5 mr-1" /> : null}
                  {isCurrent ? "Active" : "Apply"}
                </Button>
              </div>

              {/* 1. TabHeader Showcase */}
              <div className="space-y-2">
                <span className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">
                  1. Canonical TabHeader
                </span>
                <div className="bg-[#0D0E14] p-3 rounded-lg border border-white/[0.06]">
                  <TabHeader
                    title="Portfolio Hub"
                    subtitle="Live Net Worth & Allocation"
                    badge={<Badge variant="gain">+18.4%</Badge>}
                    actions={
                      <Button size="sm" variant="default">
                        Add Asset
                      </Button>
                    }
                  />
                </div>
              </div>

              {/* 2. Button Variants Showcase */}
              <div className="space-y-2">
                <span className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">
                  2. Button Primitives
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button variant="default" size="sm" loading={isLoading} disabled={isDisabled}>
                    Primary
                  </Button>
                  <Button variant="secondary" size="sm" loading={isLoading} disabled={isDisabled}>
                    Secondary
                  </Button>
                  <Button variant="outline" size="sm" loading={isLoading} disabled={isDisabled}>
                    Outline
                  </Button>
                  <Button variant="ghost" size="sm" loading={isLoading} disabled={isDisabled}>
                    Ghost
                  </Button>
                  <Button variant="destructive" size="sm" loading={isLoading} disabled={isDisabled}>
                    Delete
                  </Button>
                </div>
              </div>

              {/* 3. Card Showcase */}
              <div className="space-y-2">
                <span className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">
                  3. Card Container
                </span>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Net Worth</CardTitle>
                      <Badge variant="gain">● LIVE</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-mono font-bold text-white">
                      ₹48,25,000
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Daily P&L: <span className="text-emerald-400 font-bold">+₹32,450 (0.68%)</span>
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* 4. Badges Showcase */}
              <div className="space-y-2">
                <span className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">
                  4. Status & Value Badges
                </span>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="default">Default</Badge>
                  <Badge variant="gain">+14.2% MoS</Badge>
                  <Badge variant="loss">-3.8% SL</Badge>
                  <Badge variant="warn">Hedging</Badge>
                  <Badge variant="live">LIVE</Badge>
                </div>
              </div>

              {/* 5. Slider Showcase */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-[10px] uppercase text-slate-500 tracking-wider">
                    5. Continuous Slider
                  </span>
                  <span className="text-indigo-400">{sliderVal}% Risk</span>
                </div>
                <Slider
                  value={sliderVal}
                  onChange={setSliderVal}
                  max={100}
                  step={1}
                />
              </div>

              {/* Vertical Description */}
              <div className="mt-auto pt-4 border-t border-white/[0.06] text-xs text-slate-400 leading-relaxed">
                {preset.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* Canonical ReUI Alert Suite (Matching reui.io/components/alert) */}
      <div className="bg-[#0D0E14] border border-white/10 rounded-xl p-6 shadow-2xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h3 className="text-lg font-bold text-white">
                Official ReUI &amp; Shadcn Canonical Alert Suite
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Pure, un-customized accessible alerts directly from <span className="text-indigo-400 font-mono">reui.io/components/alert</span>. Automatically adopts the active Theme Studio skin.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-mono">Current Preset:</span>
            <span className="px-2.5 py-1 text-xs font-bold font-mono bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 rounded-full">
              {currentPreset.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 1. Basic Alert */}
          <div className="space-y-2">
            <span className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">
              1. Basic Alert
            </span>
            <UnifiedAlert title="Alert!">
              This is an alert with a title and description.
            </UnifiedAlert>
          </div>

          {/* 2. Alert with Icon */}
          <div className="space-y-2">
            <span className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">
              2. Alert with Icon
            </span>
            <UnifiedAlert
              title="Alert!"
              icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            >
              This is an alert with icon, title and description.
            </UnifiedAlert>
          </div>

          {/* 3. Security Update with Actions */}
          <div className="space-y-2">
            <span className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">
              3. Security Update with Actions
            </span>
            <UnifiedAlert
              title="Security Update"
              icon={<ShieldCheck className="w-4 h-4 text-indigo-400" />}
              action={
                <div className="flex items-center gap-2">
                  <UnifiedButton variant="ghost" size="xs">
                    Dismiss
                  </UnifiedButton>
                  <UnifiedButton variant="primary" size="xs">
                    Update
                  </UnifiedButton>
                </div>
              }
            >
              Update your password and enable 2FA.
            </UnifiedAlert>
          </div>

          {/* 4. Destructive Payment Failed */}
          <div className="space-y-2">
            <span className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">
              4. Payment Failed (Destructive)
            </span>
            <UnifiedAlert
              variant="destructive"
              title="Payment Failed"
              icon={<AlertCircle className="w-4 h-4 text-rose-400" />}
            >
              <div>Please check your payment details:</div>
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-xs text-rose-300/80">
                <li>Card number and expiry</li>
                <li>Billing address</li>
                <li>Available funds</li>
              </ul>
            </UnifiedAlert>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComponentWorkshop;
