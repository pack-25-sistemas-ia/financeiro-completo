# PERMISSIONS — Perfis e permissões

Papéis do Core (`org_role`) → perfis do produto. Autorização sempre no servidor **e** no banco (RLS + funções que checam o papel); a interface só esconde, nunca protege.

| Ação | Administrador (owner/admin) | Gestor financeiro (manager) | Analista (member) | Consulta (viewer) |
|---|---|---|---|---|
| Membros, papéis, configurações | sim | não | não | não |
| Contas: criar/editar/arquivar | sim | sim | não | não |
| Alterar saldo inicial (auditado) | sim | não | não | não |
| Categorias, centros de custo | sim | sim | não | não |
| Contrapartes, títulos (criar/editar) | sim | sim | sim | não |
| Cancelar título (sem baixas) | sim | sim | não | não |
| Baixa (pagar/receber) | sim | sim | **não** (ver D-F11) | não |
| Estorno de baixa/transferência | sim | sim | não | não |
| Transferência entre contas | sim | sim | não | não |
| Recorrências | sim | sim | criar/pausar | não |
| Importar CSV | sim | sim | sim (prévia e envio) | não |
| Conciliar / desfazer | sim / sim | sim / sim | conciliar / não | não |
| Anexos | sim | sim | enviar e ver | ver |
| Dashboards e relatórios | todos | todos | permitidos | permitidos |
| Exportar CSV (auditado) | sim | sim | não | não |

Decisão D-F11 (implementada e testada em SQL 61 e E2E fin-security): **o analista não faz baixa, estorno nem transferência** — são as operações que movem dinheiro e ficam com o gestor financeiro. O analista prepara o trabalho: cadastra contrapartes, cria e edita títulos, importa extratos/títulos, concilia e anexa comprovantes. Importar **histórico** (que cria movimentos) exige gestor. Toda função do banco confere o papel e a sessão com MFA; esconder um botão nunca é a proteção.
