export const selectors = {
  loggedIn: [
    'a[href="/direct/inbox/"]',
    'svg[aria-label="Home"]',
    'svg[aria-label="Página inicial"]',
  ],
  challenge: [
    'input[name="captcha"]',
    'text=/challenge required|confirme sua identidade|atividade incomum|temporarily blocked/i',
  ],
  searchResults: ['main a[href^="/"]'],
  profile: {
    name: ['header h2', 'header h1'],
    bio: ['header section > div', 'header span'],
    followers: [
      'header a[href$="/followers/"] span',
      'header li:has-text("seguidores") span',
      'header li:has-text("followers") span',
    ],
    private: ['text=/this account is private|esta conta é privada/i'],
    posts: ['article a[href*="/p/"]'],
    messageButton: [
      'button:has-text("Enviar mensagem")',
      '[role="button"]:has-text("Enviar mensagem")',
      'button:has-text("Message")',
      '[role="button"]:has-text("Message")',
      'button:has-text("Mensagem")',
    ],
  },
  composer: ['textarea[placeholder]', 'div[contenteditable="true"][role="textbox"]'],
  profileUnavailable: [
    'text=/esta p.gina n.o est. dispon.vel/i',
    "text=/this page isn't available|sorry, this page isn't available/i",
  ],
  recipientNotAcceptingMessages: [
    'text=/n[aã]o pode receber sua mensagem/i',
    "text=/can(?:not|'t) receive your message/i",
  ],
  sendButton: [
    'button:has-text("Send")',
    '[role="button"]:has-text("Send")',
    'button:has-text("Enviar")',
    '[role="button"]:has-text("Enviar")',
  ],
  existingMessage: ['div[dir="auto"]'],
} as const;
