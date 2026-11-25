from pathlib import Path
import re

path = Path('app/profile/equipment.js')
text = path.read_text(encoding='utf-8')

old = """  const resolvedActiveCategory =
    categoryOptions.some((section) => section.key === activeCategory)
      ? activeCategory
      : categoryOptions[0]?.key ?? null;

  const environmentCatalog = useMemo(
    () => equipmentSections.flatMap((section) => section.items),
    [equipmentSections]
  );

  const visibleCatalog = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(searchQuery.trim());
    const source = normalizedQuery
      ? environmentCatalog
      : categoryOptions.find((section) => section.key === resolvedActiveCategory)?.items ?? [];

    if (!normalizedQuery) return source;

    return source.filter((equipment) =>
      normalizeSearchValue(
        [equipment.name, equipment.category, equipment.description, equipment.uxGroup]
          .filter(Boolean)
          .join(' ')
      ).includes(normalizedQuery)
    );
  }, [categoryOptions, environmentCatalog, resolvedActiveCategory, searchQuery]);
"""
new = """  const resolvedActiveCategory =
    categoryOptions.some((section) => section.key === activeCategory)
      ? activeCategory
      : null;

  const activeCategoryOption = useMemo(
    () => categoryOptions.find((section) => section.key === resolvedActiveCategory) ?? null,
    [categoryOptions, resolvedActiveCategory]
  );

  const visibleCatalog = useMemo(() => {
    const source = activeCategoryOption?.items ?? [];
    const normalizedQuery = normalizeSearchValue(searchQuery.trim());

    if (!normalizedQuery) return source;

    return source.filter((equipment) =>
      normalizeSearchValue(
        [
          equipment.displayName,
          equipment.name,
          equipment.category,
          equipment.description,
          equipment.uxGroup,
        ]
          .filter(Boolean)
          .join(' ')
      ).includes(normalizedQuery)
    );
  }, [activeCategoryOption, searchQuery]);
"""
if old not in text:
    raise SystemExit('Derived category block not found')
text = text.replace(old, new, 1)

start_marker = '            <View style={styles.catalogTools}>'
end_marker = '            {/* INVENTAIRE */}'
start = text.index(start_marker)
end = text.index(end_marker, start)

replacement = r'''            <View style={styles.catalogTools}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.locationTabs}
              >
                {PROFILE_ENVIRONMENTS.map((location) => {
                  const selected = activeEnvironment === location.key;

                  return (
                    <Pressable
                      key={location.key}
                      onPress={() => selectProfileEnvironment(location.key)}
                      style={[
                        styles.locationTab,
                        selected && styles.locationTabSelected,
                      ]}
                    >
                      <Ionicons
                        name={location.icon}
                        size={16}
                        color={selected ? colors.brandWhite : colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.locationTabText,
                          selected && styles.locationTabTextSelected,
                        ]}
                      >
                        {location.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {!resolvedActiveCategory ? (
                <>
                  <View style={styles.categoryIntroRow}>
                    <View style={styles.categoryIntroCopy}>
                      <Text style={styles.categoryIntroTitle}>CHOISIS UNE CATÉGORIE</Text>
                      <Text style={styles.categoryIntroText}>
                        {selectedEquipmentCount} équipement{selectedEquipmentCount > 1 ? 's' : ''} sélectionné{selectedEquipmentCount > 1 ? 's' : ''} pour {activeEnvironmentLabel.toLowerCase()}.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.categoryGrid}>
                    {categoryOptions.map((category) => (
                      <Pressable
                        key={category.key}
                        onPress={() => {
                          setSearchQuery('');
                          setActiveCategory(category.key);
                        }}
                        style={({ pressed }) => [
                          styles.categoryCard,
                          pressed && styles.categoryCardPressed,
                        ]}
                      >
                        <View style={styles.categoryHeroIcon}>
                          <Ionicons
                            name={category.icon}
                            size={32}
                            color={BRAND_KAKI}
                          />
                        </View>

                        <Text style={styles.categoryCardLabel}>
                          {category.label.toUpperCase()}
                        </Text>

                        <Text numberOfLines={2} style={styles.categoryCardDescription}>
                          {category.description}
                        </Text>

                        <View style={styles.categoryCardFooter}>
                          <Text style={styles.categoryCardCount}>
                            {category.selectedCount}/{category.items.length} sélectionné{category.selectedCount > 1 ? 's' : ''}
                          </Text>
                          <Ionicons
                            name="arrow-forward"
                            size={18}
                            color={BRAND_ORANGE}
                          />
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : (
                <>
                  <Pressable
                    onPress={() => {
                      setSearchQuery('');
                      setActiveCategory(null);
                    }}
                    style={({ pressed }) => [
                      styles.categoryBackRow,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons name="arrow-back" size={18} color={BRAND_KAKI} />
                    <Text style={styles.categoryBackText}>TOUTES LES CATÉGORIES</Text>
                  </Pressable>

                  <View style={styles.activeCategoryHero}>
                    <View style={styles.activeCategoryIcon}>
                      <Ionicons
                        name={activeCategoryOption?.icon ?? 'grid-outline'}
                        size={28}
                        color={colors.brandWhite}
                      />
                    </View>
                    <View style={styles.activeCategoryCopy}>
                      <Text style={styles.activeCategoryTitle}>
                        {String(activeCategoryOption?.label ?? '').toUpperCase()}
                      </Text>
                      <Text style={styles.activeCategoryDescription}>
                        {activeCategoryOption?.description}
                      </Text>
                    </View>
                    <Text style={styles.activeCategoryCount}>
                      {activeCategoryOption?.selectedCount ?? 0}/{activeCategoryOption?.items?.length ?? 0}
                    </Text>
                  </View>

                  <View style={styles.searchShell}>
                    <Ionicons
                      name="search-outline"
                      size={19}
                      color={colors.textMuted}
                    />
                    <TextInput
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      placeholder={`Rechercher dans ${String(activeCategoryOption?.label ?? '').toLowerCase()}…`}
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      style={styles.searchInput}
                    />
                    {searchQuery.length > 0 && (
                      <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                        <Ionicons
                          name="close-circle"
                          size={19}
                          color={colors.textMuted}
                        />
                      </Pressable>
                    )}
                  </View>

                  <View style={styles.catalogSummaryRow}>
                    <Text style={styles.catalogSummaryText}>
                      {searchQuery.length > 0
                        ? `${visibleCatalog.length} RÉSULTAT${visibleCatalog.length > 1 ? 'S' : ''}`
                        : `${visibleCatalog.length} ÉQUIPEMENT${visibleCatalog.length > 1 ? 'S' : ''}`}
                    </Text>
                    <Text style={styles.catalogSummarySelected}>
                      {activeCategoryOption?.selectedCount ?? 0} SÉLECTIONNÉ{(activeCategoryOption?.selectedCount ?? 0) > 1 ? 'S' : ''}
                    </Text>
                  </View>
                </>
              )}
            </View>

'''
text = text[:start] + replacement + text[end:]

# Bodyweight is implicit on this profile screen and should not appear inside every category.
body_pattern = re.compile(
    r"\n\s*<View\s+style=\{\[\s*styles\.equipmentCard,\s*styles\.bodyweightCard,\s*\]\}\s*>[\s\S]*?</View>\s*</View>\s*\n\s*(?=\{visibleCatalog\.map\()",
    re.MULTILINE,
)
text, count = body_pattern.subn('\n              ', text, count=1)
if count != 1:
    raise SystemExit(f'Bodyweight profile card replacement count={count}')

text = text.replace(
    '{visibleCatalog.length === 0 && (',
    '{resolvedActiveCategory && visibleCatalog.length === 0 && (',
    1,
)

old_name = """                            {String(
                              equipment.name ??
                                ''
                            ).toUpperCase()}"""
new_name = """                            {String(
                              equipment.displayName ??
                                equipment.name ??
                                ''
                            ).toUpperCase()}"""
if old_name not in text:
    raise SystemExit('Equipment display name block not found')
text = text.replace(old_name, new_name, 1)

style_anchor = """  categoryTabs: {
    gap: 10,
    paddingRight: 8,
  },
"""
if style_anchor not in text:
    raise SystemExit('Category style anchor not found')

new_styles = """  categoryIntroRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  categoryIntroCopy: {
    flex: 1,
  },

  categoryIntroTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: 1.1,
    color: colors.textPrimary,
  },

  categoryIntroText: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },

  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },

  categoryCard: {
    width: '48%',
    minHeight: 168,
    padding: 15,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.10)' : colors.border,
    backgroundColor: isDark ? 'rgba(17,21,26,0.92)' : colors.surfaceElevated,
    shadowColor: colors.shadow,
    shadowOpacity: isDark ? 0.16 : 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },

  categoryCardPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.985 }],
  },

  categoryHeroIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    marginBottom: 13,
  },

  categoryCardLabel: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: 0.45,
    color: colors.textPrimary,
  },

  categoryCardDescription: {
    marginTop: 4,
    minHeight: 34,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },

  categoryCardFooter: {
    marginTop: 'auto',
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  categoryCardCount: {
    flexShrink: 1,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    color: BRAND_ORANGE,
  },

  categoryBackRow: {
    alignSelf: 'flex-start',
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  categoryBackText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: BRAND_KAKI,
  },

  activeCategoryHero: {
    minHeight: 92,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(94,102,51,0.28)',
    backgroundColor: colors.accentSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  activeCategoryIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: BRAND_KAKI,
    alignItems: 'center',
    justifyContent: 'center',
  },

  activeCategoryCopy: {
    flex: 1,
  },

  activeCategoryTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 18,
    lineHeight: 23,
    color: colors.textPrimary,
  },

  activeCategoryDescription: {
    marginTop: 2,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },

  activeCategoryCount: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 25,
    lineHeight: 28,
    color: BRAND_ORANGE,
  },

"""
text = text.replace(style_anchor, new_styles + style_anchor, 1)

path.write_text(text, encoding='utf-8')
