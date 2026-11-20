/**
 * Editor for the EXISTING W11 Composer block contract. Pure, deterministic:
 * never adds/removes blocks without user action; never edits a saved draft.
 *
 * The current Day-J compiler identifies blocks by type. Therefore this phase
 * supports one main block of each type (SKILL, STRENGTH, WOD). A repeated type
 * requires instance identities through draft, C2 preview, Day-J and Player.
 *
 * Existing 8-minute main-block floor comes from buildComposerArchitectures.
 * New proposals have protected Warm-up and Tabata (4 min) complements.
 * Older authored drafts stay unchanged even if Tabata is absent.
 */
export const COMPOSER_EDITABLE_BLOCK_TYPES = ['SKILL', 'STRENGTH', 'WOD', 'CARDIO'];
export const COMPOSER_MIN_MAIN_MINUTES = 8;

const FIXED_TYPES = ['WARMUP', 'TABATA'];
const LABELS = { SKILL: 'Skill', STRENGTH: 'Renforcement', WOD: 'WOD', CARDIO: 'Cardio' };

export function composerMainBlocks(architecture) {
  return (architecture?.blocks ?? []).filter((block) =>
    COMPOSER_EDITABLE_BLOCK_TYPES.includes(block.type)
  );
}

export function composerAddableBlocks(architecture, environmentCode = null) {
  const current = new Set(composerMainBlocks(architecture).map((block) => block.type));
  return COMPOSER_EDITABLE_BLOCK_TYPES.filter((type) => !current.has(type) && (type !== 'CARDIO' || environmentCode === 'GYM'));
}

function allocateMainMinutes(blocks, total) {
  if (!blocks.length || total < COMPOSER_MIN_MAIN_MINUTES * blocks.length) return null;
  const fixed = COMPOSER_MIN_MAIN_MINUTES * blocks.length;
  const remainder = total - fixed;
  const weights = blocks.map((item) => Math.max(1, Number(item.minutes) || 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((value) => (value / sum) * remainder);
  const mins = shares.map((share) => COMPOSER_MIN_MAIN_MINUTES + Math.floor(share));
  let left = total - mins.reduce((a, b) => a + b, 0);
  const order = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const item of order) {
    if (!left) break;
    mins[item.index] += 1;
    left -= 1;
  }
  return blocks.map((block, index) => ({ ...block, minutes: mins[index] }));
}

function rejected(message) {
  return { ok: false, error: message };
}

/**
 * action:
 *  {kind:'add', blockType:'SKILL'|'STRENGTH'|'WOD'}
 *  {kind:'remove', blockType:...}
 *  {kind:'move', blockType:..., direction:-1|1}
 *  {kind:'minutes', blockType:..., delta:-2|2}
 *  {kind:'tabata'} // Denied: obsolete optional-Tabata action
 */
export function editComposerArchitecture(architecture, action) {
  const blocks = architecture?.blocks ?? [];
  if (!Array.isArray(blocks) || !architecture || !action) {
    return rejected('Structure indisponible : reviens choisir une proposition UGEROD.');
  }
  // Existing saved Composer sessions can legitimately omit a complement
  // (e.g. user-authored Warm-up → Skill → WOD). Never inject it on edit.
  // New proposals include protected Warm-up and Tabata.
  const complements = blocks.filter((block) => FIXED_TYPES.includes(block.type));
  const tabata = complements.find((block) => block.type === 'TABATA');
  const main = composerMainBlocks(architecture);
  if ((tabata && Number(tabata.minutes) !== 4) ||
      new Set(complements.map((block) => block.type)).size !== complements.length ||
      blocks.length !== complements.length + main.length || !main.length ||
      new Set(main.map((b) => b.type)).size !== main.length) {
    return rejected('Cette structure utilise un contrat différent et ne peut pas être modifiée ici.');
  }
  const reserve = Number(architecture.transitionReserveMinutes ?? 0);
  const total = Number(architecture.estimatedMinutes ??
    blocks.reduce((sum, block) => sum + Number(block.minutes), reserve));
  const budget = total - reserve -
    complements.reduce((sum, block) => sum + Number(block.minutes), 0);
  if (!Number.isInteger(budget) || budget < COMPOSER_MIN_MAIN_MINUTES ||
      main.reduce((sum, block) => sum + Number(block.minutes), 0) !== budget) {
    return rejected('Le budget de temps doit être recalculé avant cette modification.');
  }

  // Keep old callers safe: never remove the mandatory Tabata or inject it
  // into older saved user-authored drafts missing this complement.
  if (action.kind === 'tabata') {
    return rejected('Le Tabata abdos fait partie de la préparation et ne peut pas être retiré.');
  }

  const position = main.findIndex((item) => item.type === action.blockType);
  let next = main.slice();
  let removedType = null;
  if (action.kind === 'add') {
    if (!COMPOSER_EDITABLE_BLOCK_TYPES.includes(action.blockType) || position !== -1) {
      return rejected('Ce bloc existe déjà. Un second bloc de même nature demande un contrat distinct.');
    }
    if (budget < COMPOSER_MIN_MAIN_MINUTES * (next.length + 1)) {
      return rejected('Durée insuffisante pour un bloc supplémentaire : augmente la durée de la séance.');
    }
    const average = Math.max(COMPOSER_MIN_MAIN_MINUTES, Math.round(budget / (next.length + 1)));
    next = allocateMainMinutes([
      ...next, { type: action.blockType, label: LABELS[action.blockType], minutes: average },
    ], budget);
  } else if (action.kind === 'remove') {
    if (position === -1) return rejected('Le bloc demandé est absent.');
    if (next.length === 1) return rejected('Conserve au moins un bloc principal dans ta séance.');
    removedType = action.blockType;
    next = allocateMainMinutes(next.filter((block) => block.type !== action.blockType), budget);
  } else if (action.kind === 'move') {
    const target = position + Number(action.direction);
    if (position < 0 || ![-1, 1].includes(Number(action.direction)) ||
        target < 0 || target >= next.length) {
      return rejected('Ce bloc est déjà à cette position.');
    }
    [next[position], next[target]] = [next[target], next[position]];
  } else if (action.kind === 'minutes') {
    if (position < 0 || ![-2, 2].includes(Number(action.delta))) {
      return rejected('Ajustement de durée invalide.');
    }
    if (next.length === 1) return rejected('Toute la durée principale est déjà affectée à ce bloc.');
    const delta = Number(action.delta);
    if (delta < 0 && next[position].minutes + delta < COMPOSER_MIN_MAIN_MINUTES) {
      return rejected('La durée minimale de ce bloc est de 8 minutes.');
    }
    const others = next.map((block, index) => index).filter((i) => i !== position);
    if (delta > 0 && others.reduce((sum, index) =>
      sum + Math.max(0, next[index].minutes - COMPOSER_MIN_MAIN_MINUTES), 0) < delta) {
      return rejected('Les autres blocs ne peuvent pas perdre davantage de temps.');
    }
    next = next.map((b) => ({ ...b }));
    next[position].minutes += delta;
    if (delta > 0) {
      let left = delta;
      for (const index of others) {
        const take = Math.min(left, next[index].minutes - COMPOSER_MIN_MAIN_MINUTES);
        next[index].minutes -= take;
        left -= take;
        if (!left) break;
      }
    } else {
      next[others[0]].minutes -= delta;
    }
  } else {
    return rejected('Modification de structure inconnue.');
  }

  if (!next || next.reduce((sum, b) => sum + Number(b.minutes), 0) !== budget) {
    return rejected('Impossible de respecter la durée prévue.');
  }
  return {
    ok: true,
    removedType,
    architecture: {
      ...architecture,
      key: 'custom',
      title: 'Structure personnalisée',
      recommended: false,
      blocks: [...complements.map((block) => ({ ...block })), ...next],
      estimatedMinutes: total,
      transitionReserveMinutes: reserve,
    },
  };
}
