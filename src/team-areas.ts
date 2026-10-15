import { Wrench, Zap, Code2, ClipboardList, PenTool, Target, Wallet, BriefcaseBusiness, Megaphone, Settings, Users } from 'lucide-react';
import type { Area } from './data';

const normalized = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Closet was historically entered as an area. Keep its ID and records intact
// until an authorized user explicitly assigns each item to a real team area.
export const isStorageArea = (area: Area) => ['closet', 'storage-closet'].includes(normalized(area.name));
export const teamAreaLabel = (area?: Area) => !area ? 'Unassigned' : isStorageArea(area) ? `Needs team area (${area.name})` : area.name;

const icons = {
  fabrication: Wrench, power: Zap, software: Code2, operations: ClipboardList,
  cad: PenTool, strategy: Target, finance: Wallet, business: BriefcaseBusiness,
  communications: Megaphone, 'general-admin': Settings,
};

// Database IDs can be UUIDs and query order can change. Use the actual meaning
// of the area, never its position in the list; custom areas get a neutral icon.
export const teamAreaIcon = (area: Area) => icons[normalized(area.name) as keyof typeof icons] ?? Users;
