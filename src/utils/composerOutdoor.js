import { OUTDOOR_PLACES } from '../constants/outdoorContext';

export const COMPOSER_OUTDOOR_VERSION = 'COMPOSER_OUTDOOR_V1';

export function composerOutdoorContext(preparation = {}, saved = {}) {
  const placeCode = preparation.outdoorPlaceCode ?? saved.place_code ?? null;
  const place = OUTDOOR_PLACES.find((item) => item.code === placeCode);
  return {
    place_code: placeCode,
    surface_code: preparation.surfaceCode ?? place?.surface ?? saved.surface_code ?? null,
    running_allowed: preparation.runningAllowed ?? saved.running_allowed ?? true,
    reliable_distance: preparation.reliableDistance ?? saved.reliable_distance ?? false,
  };
}

export function composerUsesOutdoorEngine(draft) {
  return draft?.environment_code === 'OUTDOOR' && draft?.outdoor_engine_version === COMPOSER_OUTDOOR_VERSION;
}
