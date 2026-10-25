import { getMake, getModel } from '@/data/vehicles';
import type { Lang, Vehicle } from '@/domain/types';

export function vehicleTitle(vehicle: Vehicle, lang: Lang): string {
  const make = getMake(vehicle.makeId)?.name[lang] ?? '';
  const model = getModel(vehicle.modelId)?.name[lang] ?? '';
  return `${make} ${model}`.trim();
}

export function vehicleLabel(vehicle: Vehicle, lang: Lang): string {
  return `${vehicleTitle(vehicle, lang)} ${vehicle.year}`;
}

export function vehicleSpec(vehicle: Vehicle): string {
  return `${vehicle.trim} · ${vehicle.engine}`;
}

/** ISO 3779: 17 characters, excluding I, O and Q. */
export function isValidVin(vin: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin.toUpperCase());
}

/** VINs are shown in two groups (9 + 8) for easier matching and never wrap (guidelines p.30). */
export function formatVin(vin: string): string {
  const v = vin.toUpperCase();
  return v.length === 17 ? `${v.slice(0, 9)}\u00A0${v.slice(9)}` : v;
}
