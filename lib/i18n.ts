// Lean FR/EN dictionary shared by server + client components. The chosen language
// is persisted in the `lang` cookie so server components (listing content) and
// client components (UI chrome) stay in sync.
export type Lang = 'fr' | 'en';
export const LANG_COOKIE = 'lang';
export const DEFAULT_LANG: Lang = 'fr';

export const dict = {
  fr: {
    brand: 'Agence Lumière',
    lang_fr: 'FR',
    lang_en: 'EN',
    home_subtitle:
      'Parcourez nos biens et discutez avec notre assistant pour organiser une visite.',
    home_empty: 'Aucun bien pour le moment. Lancez',
    rooms: 'pièces',
    back_all: '← Tous les biens',
    key_features: 'Points clés',
    chat_title: 'Assistant Agence Lumière',
    chat_subtitle:
      'Posez vos questions sur ce bien — je peux aussi organiser une visite.',
    chat_placeholder: 'Écrivez votre message…',
    send: 'Envoyer',
    viewing_confirmed: 'Visite confirmée',
    manual_banner: 'Un conseiller a pris la suite de cette conversation.',
    admin_space: 'Espace agence',
    leads: 'Leads',
    no_leads: 'Aucun lead pour le moment.',
    anon_visitor: 'Visiteur anonyme',
    assistant_title: 'Assistant agence',
    assistant_examples:
      '« Quels leads sont les plus chauds ? » · « Ajoute un critère quartier »',
    link_telegram: 'Lier Telegram',
    logout: 'Déconnexion',
    link_info: 'Envoyez ceci au bot Telegram :',
    assistant_placeholder: 'Écrivez à votre assistant…',
    assistant_empty: 'Posez une question pour commencer.',
    login_title: 'Espace agence',
    login_subtitle: 'Connectez-vous pour accéder à votre assistant.',
    email_ph: 'Email',
    password_ph: 'Mot de passe',
    login_btn: 'Se connecter',
    login_error: 'Identifiants invalides.',
    tab_assistant: 'Assistant',
    tab_dashboard: 'Tableau de bord',
    tab_conversations: 'Conversations',
    tab_config: 'Configuration',
    dash_total: 'Total leads',
    dash_active: 'Actifs',
    dash_qualified: 'Qualifiés',
    dash_booked: 'Visites réservées',
    dash_handoff: 'À traiter (handoff)',
    conv_select: 'Sélectionnez un lead pour voir la conversation.',
    conv_takeover: 'Prendre la main',
    conv_release: 'Rendre à l’IA',
    conv_send: 'Envoyer',
    conv_reply_ph: 'Répondre au lead…',
    conv_qual: 'Qualification',
    cfg_listings: 'Biens',
    cfg_criteria: 'Critères de qualification',
    cfg_rules: 'Règles de handoff',
    cfg_add: 'Ajouter',
    cfg_delete: 'Supprimer',
    cfg_save: 'Enregistrer',
    cfg_active: 'Actif',
    login: 'Se connecter',
    login_email_prompt: 'Votre email pour sauvegarder la conversation',
    login_send: 'Recevoir le lien',
    login_sent: 'Lien envoyé ! Vérifiez votre email.',
    login_dev: 'Lien (dev) :',
    logged_in: 'Connecté',
    greeting: (title: string) =>
      `Bonjour ! Je suis l'assistant d'Agence Lumière. Je peux répondre à vos questions sur ${title} et organiser une visite. Que souhaitez-vous savoir ?`
  },
  en: {
    brand: 'Agence Lumière',
    lang_fr: 'FR',
    lang_en: 'EN',
    home_subtitle:
      'Browse our properties and chat with our assistant to arrange a viewing.',
    home_empty: 'No properties yet. Run',
    rooms: 'rooms',
    back_all: '← All properties',
    key_features: 'Key features',
    chat_title: 'Agence Lumière Assistant',
    chat_subtitle:
      'Ask anything about this property — I can also arrange a viewing.',
    chat_placeholder: 'Type your message…',
    send: 'Send',
    viewing_confirmed: 'Viewing confirmed',
    manual_banner: 'An advisor has taken over this conversation.',
    admin_space: 'Agency space',
    leads: 'Leads',
    no_leads: 'No leads yet.',
    anon_visitor: 'Anonymous visitor',
    assistant_title: 'Agency assistant',
    assistant_examples:
      '"Which leads are hottest?" · "Add a preferred-area criterion"',
    link_telegram: 'Link Telegram',
    logout: 'Log out',
    link_info: 'Send this to the Telegram bot:',
    assistant_placeholder: 'Message your assistant…',
    assistant_empty: 'Ask a question to get started.',
    login_title: 'Agency space',
    login_subtitle: 'Sign in to access your assistant.',
    email_ph: 'Email',
    password_ph: 'Password',
    login_btn: 'Sign in',
    login_error: 'Invalid credentials.',
    tab_assistant: 'Assistant',
    tab_dashboard: 'Dashboard',
    tab_conversations: 'Conversations',
    tab_config: 'Configuration',
    dash_total: 'Total leads',
    dash_active: 'Active',
    dash_qualified: 'Qualified',
    dash_booked: 'Booked viewings',
    dash_handoff: 'Needs attention (handoff)',
    conv_select: 'Select a lead to view the conversation.',
    conv_takeover: 'Take over',
    conv_release: 'Return to AI',
    conv_send: 'Send',
    conv_reply_ph: 'Reply to the lead…',
    conv_qual: 'Qualification',
    cfg_listings: 'Listings',
    cfg_criteria: 'Qualification criteria',
    cfg_rules: 'Handoff rules',
    cfg_add: 'Add',
    cfg_delete: 'Delete',
    cfg_save: 'Save',
    cfg_active: 'Active',
    login: 'Log in',
    login_email_prompt: 'Your email to save the conversation',
    login_send: 'Send link',
    login_sent: 'Link sent! Check your email.',
    login_dev: 'Link (dev):',
    logged_in: 'Logged in',
    greeting: (title: string) =>
      `Hello! I'm the Agence Lumière assistant. I can answer your questions about ${title} and arrange a viewing. What would you like to know?`
  }
} as const;

export type Dict = (typeof dict)[Lang];

export function getDict(lang: Lang): Dict {
  return dict[lang] ?? dict[DEFAULT_LANG];
}

export function normalizeLang(value: string | undefined | null): Lang {
  return value === 'en' ? 'en' : 'fr';
}
