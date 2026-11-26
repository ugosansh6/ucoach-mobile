import { OUTDOOR_PLACES, selectableOutdoorPlaces, terrainOptionsForPlace, TERRAIN_OPTIONS } from '../constants/outdoorContext';

// Display and input validation only. The outdoor catalogue and the backend
// continue to own the allowed context and session generation rules.
export function frameOutdoorPlace(context) {
  return OUTDOOR_PLACES.find(place => place.code === context?.place_code) ?? null;
}
export function frameSurfaceValid(context) {
  const place = frameOutdoorPlace(context);
  return Boolean(place && (place.surface
    ? context?.surface_code === place.surface
    : terrainOptionsForPlace(place).some(terrain => terrain.code === context?.surface_code)));
}
export function frameCanContinue(environment, context, equipmentLoading) {
  return !equipmentLoading && ['HOME', 'BOX', 'GYM', 'OUTDOOR'].includes(environment)
    && (environment !== 'OUTDOOR' || frameSurfaceValid(context));
}
export function frameSelectPlace(context, code) {
  const place = selectableOutdoorPlaces().find(item => item.code === code);
  if (!place) return context;
  const next = { ...context, place_code: code };
  return { ...next, surface_code: place.surface ?? (frameSurfaceValid(next) ? context.surface_code : null) };
}
export function frameSelectSurface(context, code) {
  const next = { ...context, surface_code: code };
  return frameSurfaceValid(next) ? next : context;
}
export function frameSurfaceLabel(context) {
  if (!frameSurfaceValid(context)) return '';
  return TERRAIN_OPTIONS.find(item => item.code === context.surface_code)?.label
    ?? (context.surface_code === 'TRACK' ? 'Piste' : '');
}
export function frameDurationStep(durations, value, direction) {
  if (direction > 0) return durations.find(item => item > value) ?? value;
  if (direction < 0) return [...durations].reverse().find(item => item < value) ?? value;
  return value;
}
export function frameDurationDrag(durations, value, dx) {
  const offset = -Math.sign(dx) * Math.round(Math.abs(dx) / 64);
  let next = value;
  for (let i = 0; i < Math.min(Math.abs(offset), durations.length); i++) {
    next = frameDurationStep(durations, next, Math.sign(offset));
  }
  return next;
}
