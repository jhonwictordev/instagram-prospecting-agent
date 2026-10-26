# Case Comercial — Agente Autônomo de Prospecção no Instagram com Human-in-the-Loop

## PROBLEMA
Empresas que vendem serviços de alto valor (produtoras audiovisuais, estúdios de design, consultorias, agências e softwares B2B) dependem de novos clientes, mas a prospecção manual no Instagram consome horas da equipe e ferramentas de disparo em massa geram bloqueios severos no perfil da empresa por violar as diretrizes da Meta, além de enviarem mensagens robotizadas e genéricas que queimam a imagem da marca.

## SOLUÇÃO
O **Instagram Prospecting Agent** é um sistema de automação avançada que combina a orquestração de fluxos do **n8n**, a precisão de um worker automatizado com **Playwright** e a segurança de um banco de dados relacional **PostgreSQL**. O grande diferencial da solução é o protocolo **Human-in-the-Loop**: a máquina localiza os perfis ideais, extrai informações da bio e gera abordagens personalizadas, mas a mensagem só é despachada após um operador humano clicar em "Aprovar" no painel, garantindo 100% de pertinência e risco zero de mensagens inadequadas.

## FUNCIONALIDADES COMPROVADAS
- **Mineração e Enriquecimento de Perfis**: Busca estruturada de perfis segmentados por nicho (ex: turismo, hotelaria, clínicas, gastronomia).
- **Fila de Moderação e Aprovação Humana**: Painel interativo no n8n onde o time comercial visualiza a foto do perfil, o texto sugerido e decide se aprova, edita ou rejeita o lead antes do envio.
- **Worker de Execução com Playwright**: Navegador automatizado que realiza o login seguro, navega até o perfil e simula pausas e digitação de usuário real para contatar o lead no Direct.
- **Trilha de Auditoria e Captura de Telas**: Gravação de capturas de tela comprobatórias de cada envio ou falha de conexão para conferência e auditoria.
- **Persistência Estruturada em PostgreSQL**: Armazenamento do histórico de contatos para impedir abordagens repetidas ao mesmo perfil em campanhas futuras.

## TECNOLOGIAS VERIFICADAS
- **Orquestrador de Workflows**: n8n (workflows exportados e versionados em JSON).
- **Automação de Navegador**: Playwright, Node.js, TypeScript.
- **Banco de Dados**: PostgreSQL, esquemas de leads e status de interação.
- **Infraestrutura**: Docker Compose para subida imediata de n8n e PostgreSQL.
- **Evidências Reais**: Histórico documentado de execuções reais com resultados salvos em JSON (`prospecting-results-*.json`).

## DIFERENCIAIS
- **Abordagem Segura Human-in-the-Loop**: Une a velocidade da automação robótica com o discernimento humano, protegendo a conta oficial contra bloqueios e mantendo a reputação impecável.
- **Economia de Horas Operacionais**: Automatiza 80% do trabalho braçal de busca e digitação, deixando o profissional focado apenas em qualificar respostas positivas.
- **Aderência Prática Comprovada**: Desenvolvido e validado para uso real no segmento de turismo e produção audiovisual.

## STATUS
**Solução Funcional com Validação em Ambiente Real** — Workflows n8n, worker Playwright e banco de dados integrados, com relatórios de prospecção reais em formato estruturado.

## VALOR COMERCIAL
- **Geração Contínua de Oportunidades**: Mantém a agenda do time de vendas abastecida diariamente com novos decisores interessados.
- **Taxa de Conversão Expressivamente Maior**: Mensagens contextuais e personalizadas atingem taxas de resposta até 5x superiores às de mensagens padronizadas de spam.
- **Independência de Mídia Paga**: Permite captar clientes de alto ticket sem investir milhares de reais em anúncios patrocinados no Meta Ads.
