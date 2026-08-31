import { useMemo } from 'react';
import { useUserColors } from '../api/hooks';
import {
  buildEffectiveCatalog,
  loadBaseCatalog,
  type EffectiveColor,
  type UserColor,
} from '../color/catalog';

export function useEffectiveCatalog(): {
  colors: EffectiveColor[];
  byCode: Map<string, EffectiveColor>;
  isLoading: boolean;
} {
  const { data, isLoading } = useUserColors();

  return useMemo(() => {
    const userColors: UserColor[] = (data ?? []).map((c) => ({
      code: c.code,
      hex: c.hex,
      source: c.source,
      base_hex: c.base_hex ?? undefined,
    }));
    const colors = buildEffectiveCatalog(loadBaseCatalog(), userColors);
    return { colors, byCode: new Map(colors.map((c) => [c.code, c])), isLoading };
  }, [data, isLoading]);
}
