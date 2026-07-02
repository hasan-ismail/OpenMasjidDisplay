// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Built-in hadith library shown during salah (the minutes after each Iqāmah). These
 * ahadith on the virtue of Salāh are sourced from the Madani Academy "Salah Workshop"
 * booklet; the English translations and citations are reproduced verbatim.
 *
 * Each has a stable `id` so a masjid can turn individual ahadith off (persisted in
 * SalahHadith.disabledDefaults) without disturbing the rest, and still add their own.
 *
 * NOTE: the `ar` (Arabic) field is intentionally left empty for now. The source PDF's
 * Arabic did not extract cleanly, and we do NOT put unverified sacred Arabic on a masjid
 * screen — a maintainer should paste the verified Arabic text for each before enabling it
 * on Arabic-first displays. The display renders English-only entries correctly.
 */
export interface DefaultHadith {
  id: string;
  ar: string;
  en: string;
  /** short source attribution shown under the text */
  cite: string;
}

export const DEFAULT_SALAH_HADITH: DefaultHadith[] = [
  {
    id: 'first-account',
    ar: '',
    en: 'The first action for which a servant of Allah will be held accountable on the Day of Resurrection will be his prayers. If they are in order, he will have prospered and succeeded. If they are lacking, he will have failed and lost. If there is something defective in his obligatory prayers, then the Almighty Lord will say: See if My servant has any voluntary prayers that can complete what is insufficient in his obligatory prayers. The rest of his deeds will be judged the same way.',
    cite: 'al-Tirmidhī:413',
  },
  {
    id: 'first-account-deeds',
    ar: '',
    en: 'The first action for which a servant of Allah will be held accountable on the Day of Resurrection will be his prayers. If they are in order, then all his actions will be in order and if they are not in order, then all his actions will be ruined.',
    cite: 'al-Muʿjam al-Awsat lil-Tabrānī:1859',
  },
  {
    id: 'miss-asr-family-property',
    ar: '',
    en: 'Whoever misses ‘Asr Salāh, it is as if he lost all his family and property.',
    cite: 'al-Bukhārī:552 & Muslim:626',
  },
  {
    id: 'before-sunrise-sunset',
    ar: '',
    en: 'He who offers Salāh before the rising of the sun and before its setting, [i.e., Fajr and ‘Asr], will not enter Jahannam.',
    cite: 'Muslim:633',
  },
  {
    id: 'fails-asr-nullified',
    ar: '',
    en: 'If someone fails to pray ‘Asr, his actions will be nullified.',
    cite: 'al-Bukhārī:553, 594',
  },
  {
    id: 'omits-salah-angry',
    ar: '',
    en: 'Whoever omits his Salāh, while he has the ability to pray, will meet Allah in such a condition that Allah will be angry with him.',
    cite: 'al-Sunan al-Kubrā lil-Bayhaqī:3390',
  },
  {
    id: 'distinguish-right-left',
    ar: '',
    en: 'When a boy is able to distinguish right from left, then command him to pray.',
    cite: 'Abū Dāwūd:497',
  },
  {
    id: 'command-children-seven',
    ar: '',
    en: 'Command your children to pray when they become seven years old, and beat them for it (prayer) when they become ten years old; and arrange their beds (to sleep) separately.',
    cite: 'Abū Dāwūd:495, 496 & al-Tirmidhī:407',
  },
  {
    id: 'key-to-jannah',
    ar: '',
    en: 'The key to Jannah is Salāh and the key to Salāh is Wudhū.',
    cite: 'al-Tirmidhī:4',
  },
  {
    id: 'wudhu-two-rakaat-jannah',
    ar: '',
    en: 'If any Muslim performs Wudhū well then stands up and performs two Rakaʿāt of Salāh with full devotion and concentration then Jannah will be compulsory for him.',
    cite: 'Abū Dāwūd:169, 906 & Muslim:234',
  },
  {
    id: 'wudhu-salah-sins-forgiven',
    ar: '',
    en: 'One who offers Wudhū like he is commanded to, and reads Salāh like he is commanded, will have his past (minor) sins forgiven.',
    cite: 'Ibn Mājah:1396 & al-Nasā-ī:144',
  },
  {
    id: 'communication-with-allah',
    ar: '',
    en: 'When any of you is in Salāh he is actually in communication with Allah...',
    cite: 'al-Bukhārī:405, 417, 531 & Muslim:551',
  },
  {
    id: 'allah-turns-towards',
    ar: '',
    en: 'Certainly, when a man stands to offer Salāh, Allah turns His [special mercies] towards him until he turns away [i.e., completes his Salāh] or commits an act against the dedication of Salāh.',
    cite: 'Ibn Mājah:1023',
  },
  {
    id: 'resort-to-salah',
    ar: '',
    en: 'Whenever the Messenger of Allah ﷺ faced an important and grim situation, he would resort to Salāh.',
    cite: 'Abū Dāwūd:1319',
  },
  {
    id: 'five-equal-fifty',
    ar: '',
    en: '...These are five prayers and they are all (equal to) fifty (in reward), for My Word does not change.',
    cite: 'al-Bukhārī:349 & Muslim:163',
  },
  {
    id: 'five-obligatory-guarantee',
    ar: '',
    en: 'Allah has made five Salāh obligatory on His servants. Whomsoever performs Wudhū in a perfect manner, offers them on time, completes the rukūʿ properly and [offers the Salāh] with full concentration, has a guarantee that Allah will forgive him. Whosoever does not do so, does not have any guarantee from Allah; if He wishes He may forgive him, or if He chooses, He will punish him.',
    cite: 'Abū Dāwūd:425 & Ibn Mājah:1401',
  },
  {
    id: 'pledge-between-us',
    ar: '',
    en: 'The pledge between us and them is prayer; whosoever leaves it has rejected faith.',
    cite: 'al-Tirmidhī:2621 & al-Nasā-ī:463 & Ibn Mājah:1079',
  },
  {
    id: 'light-proof-salvation',
    ar: '',
    en: 'Whoever protects Salāh [and is punctual in performing it], the Salāh will be a source of light, a proof, and a means of salvation on the Day of Qiyāmah. Whomsoever is [unmindful] and does not protect his Salāh, it will not be a source of light, nor a proof, nor will it be a means of salvation. On the Day of Qiyāmah, he will be with Qārūn, Hāmān, Firʿaun, and Ubayy ibn Khalaf.',
    cite: 'Ahmad, al-Dārimī, Ibn Hibbān',
  },
  {
    id: 'do-not-neglect-deliberately',
    ar: '',
    en: 'Do not associate anything with Allah, even if you are cut and burned. Do not neglect any prescribed prayer deliberately, for whoever neglects it deliberately no longer has the protection of Allah. And do not drink wine, for it is the key to all evil.',
    cite: 'Ibn Mājah:4034',
  },
];
