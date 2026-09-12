import pathlib
p = pathlib.Path('src/screens/recovery.tsx')
text = p.read_text(encoding='utf-8')

old = '\t\t\t\t\t\t\t{plan && slotsToday.length === 0 ? (\n\t\t\t\t\t\t\t\t<Txt v="small" color={colors.inkSoft} center style={styles.gentleLine}>\n\t\t\t\t\t\t\t\t\tNo open time left today. A five-minute pause can still fit between the seams.\n\t\t\t\t\t\t\t\t</Txt>\n\t\t\t\t\t\t\t) : (\n\t\t\t\t\t\t\t\t<>\n\t\t\t\t\t\t\t\t\t<View style={styles.slotSummary}>\n\t\t\t\t\t\t\t\t\t\t<Emoji size={14}>⏳</Emoji>\n\t\t\t\t\t\t\t\t\t\t<Txt v="small" color={colors.inkSoft}>\n\t\t\t\t\t\t\t\t\t\t\t{slotsToday.length} free window{slotsToday.length === 1 ? \'\' : \'s\'} ·{\' \'}\n\t\t\t\t\t\t\t\t\t\t\t{formatMin(totalFreeMinutes)} today'

new = '\t\t\t\t\t\t\t{plan && displaySlots.length === 0 ? (\n\t\t\t\t\t\t\t\t<Txt v="small" color={colors.inkSoft} center style={styles.gentleLine}>\n\t\t\t\t\t\t\t\t\tNo open time left today. A five-minute pause can still fit between the seams.\n\t\t\t\t\t\t\t\t</Txt>\n\t\t\t\t\t\t\t) : (\n\t\t\t\t\t\t\t\t<>\n\t\t\t\t\t\t\t\t\t<View style={styles.slotSummary}>\n\t\t\t\t\t\t\t\t\t\t<Emoji size={14}>⏳</Emoji>\n\t\t\t\t\t\t\t\t\t\t<Txt v="small" color={colors.inkSoft}>\n\t\t\t\t\t\t\t\t\t\t\t{displaySlots.length} free window{displaySlots.length === 1 ? \'\' : \'s\'} ·{\' \'}\n\t\t\t\t\t\t\t\t\t\t\t{formatMin(displayTotalMinutes)} today'

if old in text:
    text = text.replace(old, new)
    p.write_text(text, encoding='utf-8')
    print('OK')
else:
    print('NOT FOUND')
