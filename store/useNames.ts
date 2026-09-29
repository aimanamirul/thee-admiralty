'use client';

import { useMemo } from 'react';
import { moduleName, projectName, protocolName, protocolShort, resolveText, vendorCountry, vendorName, vendorShort, type Skin } from '@/lib/data/names';
import { useFleetStore } from './useFleetStore';

export interface Names {
  skin: Skin;
  /** vendor name, short code, country */
  v: (id: string) => string;
  vs: (id: string) => string;
  c: (id: string) => string;
  /** module, R&D project, protocol (long / short) */
  m: (id: string) => string;
  p: (id: string) => string;
  x: (protocol: string) => string;
  xs: (protocol: string) => string;
  /** Resolve name tokens embedded in engine / lesson text. */
  t: (text: string) => string;
}

/** Skin-aware display names; components re-render when the skin changes. */
export function useNames(): Names {
  const skin = useFleetStore((s) => s.skin);
  return useMemo(
    () => ({
      skin,
      v: (id) => vendorName(id, skin),
      vs: (id) => vendorShort(id, skin),
      c: (id) => vendorCountry(id, skin),
      m: (id) => moduleName(id, skin),
      p: (id) => projectName(id, skin),
      x: (p) => protocolName(p, skin),
      xs: (p) => protocolShort(p, skin),
      t: (text) => resolveText(text, skin),
    }),
    [skin],
  );
}
