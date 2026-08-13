'use client';

import React from 'react';
import {
  Add, Archive, ArrowLeft2, ArrowRight2, ArrowRotateLeft, ArrowRotateRight, Calendar, Category,
  Chart2, CloseCircle, DocumentText, Edit2, Eye, EyeSlash, HambergerMenu, InfoCircle, LogoutCurve, Moon,
  Minus, People, Printer, ScanBarcode, ShieldSlash, Sun1, TickCircle, Buildings2, AddSquare, User, Link2,
  Trash, Lock1, Unlock, ProfileAdd, Setting2, Global,
  Send2, Flash, DocumentDownload, Refresh2, Hashtag, Layer, Grid2, Judge, ReceiptText,
  Sms, Stickynote, ShieldTick, Bank,
} from 'iconsax-react';

export type IconProps = { className?: string; size?: number };

/** Wrap an iconsax glyph so it takes className (colour via currentColor) + size. */
const mk =
  (C: React.ComponentType<Record<string, unknown>>, variant: string = 'Linear') =>
  function Icon({ className, size = 20 }: IconProps) {
    return <C size={size} color="currentColor" variant={variant} className={className} />;
  };

export const Ico = {
  dashboard: mk(Category),
  chart: mk(Chart2),
  filePlus: mk(AddSquare),
  files: mk(DocumentText),
  building: mk(Buildings2),
  users: mk(People),
  calendar: mk(Calendar),
  pen: mk(Edit2),
  check: mk(TickCircle),
  archive: mk(Archive),
  user: mk(User),
  logout: mk(LogoutCurve),
  menu: mk(HambergerMenu),
  close: mk(CloseCircle),
  sun: mk(Sun1),
  moon: mk(Moon),
  qr: mk(ScanBarcode),
  eye: mk(Eye),
  eyeOff: mk(EyeSlash),
  print: mk(Printer),
  trash: mk(Trash),
  lock: mk(Lock1),
  unlock: mk(Unlock),
  userAdd: mk(ProfileAdd),
  chevron: mk(ArrowRight2),
  chevronLeft: mk(ArrowLeft2),
  link: mk(Link2),
  settings: mk(Setting2),
  globe: mk(Global),
  add: mk(Add),
  minus: mk(Minus),
  undo: mk(ArrowRotateLeft),
  redo: mk(ArrowRotateRight),
  info: mk(InfoCircle),
  /** ЭЦП is not wired up yet — see the sign dialog. */
  shieldOff: mk(ShieldSlash),
  // Konveyer action glyphs (talabnoma/ariza/sud flow).
  send: mk(Send2),
  flash: mk(Flash),
  download: mk(DocumentDownload),
  refresh: mk(Refresh2),
  hashtag: mk(Hashtag),
  layer: mk(Layer),
  sheet: mk(Grid2),
  judge: mk(Judge),
  receipt: mk(ReceiptText),
  // Pipeline step glyphs (Boshqaruv stepper): Talabnoma → Palata → Sud → MIB.
  sms: mk(Sms),           // talabnoma — demand letter
  stamp: mk(Stickynote),  // sanoat palatasi — ariza tayyorlash/imzo
  court: mk(Bank),        // sud — kolonnali bino (sud/rasmiy idora)
  shield: mk(ShieldTick), // MIB — majburiy ijro
};

/**
 * Named exports for *server* components.
 *
 * The RSC boundary turns each named export of a 'use client' module into a client reference.
 * Properties of an exported object are not named exports, so `<Ico.chevron />` inside a server
 * component throws at render. Client components keep using the `Ico` registry.
 */
export const IconChevronLeft = mk(ArrowLeft2);
export const IconChevronRight = mk(ArrowRight2);

/** Registry for nav items — referenced by string key so server components can pass nav data. */
export const NAV_ICONS: Record<string, React.ComponentType<IconProps>> = {
  dashboard: Ico.dashboard,
  chart: Ico.chart,
  'file-plus': Ico.filePlus,
  files: Ico.files,
  building: Ico.building,
  users: Ico.users,
  calendar: Ico.calendar,
  pen: Ico.pen,
  check: Ico.check,
  archive: Ico.archive,
  user: Ico.user,
  link: Ico.link,
  lock: Ico.lock,
  settings: Ico.settings,
  sms: Ico.sms,
  stamp: Ico.stamp,
  judge: Ico.judge,
  court: Ico.court,
  shield: Ico.shield,
};
