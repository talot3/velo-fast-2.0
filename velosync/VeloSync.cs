using System;
using System.Drawing;
using System.Windows.Forms;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace VeloSync
{
    public class Program
    {
        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }

    public class MainForm : Form
    {
        private NotifyIcon trayIcon;
        private ContextMenu trayMenu;
        private TabControl tabControl;
        private TabPage tabGeral;
        private TabPage tabSync;
        private TabPage tabLogs;

        // Processo do Node.js
        private Process nodeProcess;
        private string serverJsPath = "server.js";

        // Elementos da Aba Geral
        private TextBox txtId;
        private TextBox txtLicenca;
        private TextBox txtNomeFantasia;
        private TextBox txtDataVencimento;
        private TextBox txtCNPJ;
        private TextBox txtHabilitacoes;
        private Label lblIPs;
        private ListBox lstTerminais;

        // Elementos da Aba Sincronização
        private Label lblStatusServico;
        private Label lblProximoCiclo;
        private Button btnSyncNow;
        private ListView lvImportacao;
        private ListView lvExportacao;

        // Elementos da Aba Logs
        private TextBox txtLogs;

        // Timers
        private System.Windows.Forms.Timer pollTimer;
        private int secondsToNextSync = 300; // 5 minutos

        public MainForm()
        {
            this.Text = "VeloSync - Concentrador Local";
            this.Size = new Size(820, 620);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedSingle;
            this.MaximizeBox = false;

            // Tentar carregar ícone personalizado (icon.png)
            Icon customIcon = null;
            try
            {
                // Ícone em assets/ (um nível acima da pasta velosync/ onde o .exe reside)
                string exeDir = AppDomain.CurrentDomain.BaseDirectory;
                string iconPath = Path.Combine(exeDir, "..", "assets", "icon.png");
                if (!File.Exists(iconPath))
                {
                    // Fallback: mesma pasta do executável (compatibilidade com execução direta)
                    iconPath = Path.Combine(exeDir, "icon.png");
                }
                if (File.Exists(iconPath))
                {
                    using (Bitmap bmpCustom = new Bitmap(iconPath))
                    {
                        customIcon = Icon.FromHandle(bmpCustom.GetHicon());
                    }
                }
            }
            catch (Exception ex)
            {
                // Fallback silencioso em caso de erro ao ler imagem
            }

            this.Icon = customIcon ?? SystemIcons.Application;

            // Configuração do Tray Icon (Bandeja do Sistema)
            trayMenu = new ContextMenu();
            trayMenu.MenuItems.Add("Abrir Painel", OnTrayOpen);
            trayMenu.MenuItems.Add("Sincronizar Agora", OnTraySync);
            trayMenu.MenuItems.Add("-");
            trayMenu.MenuItems.Add("Sair", OnTrayExit);

            trayIcon = new NotifyIcon();
            trayIcon.Text = "VeloSync - Concentrador Local";
            trayIcon.Icon = customIcon ?? SystemIcons.Shield;
            trayIcon.ContextMenu = trayMenu;
            trayIcon.Visible = true;
            trayIcon.DoubleClick += OnTrayOpen;

            // Inicializa a UI
            InitializeUI();

            // Inicia o Servidor Node.js oculto
            StartNodeServer();

            // Configura o timer de atualização de dados (a cada 2 segundos)
            pollTimer = new System.Windows.Forms.Timer();
            pollTimer.Interval = 2000;
            pollTimer.Tick += OnPollTick;
            pollTimer.Start();

            // Captura o evento F5 global na janela
            this.KeyPreview = true;
            this.KeyDown += MainForm_KeyDown;

            // Ao fechar, apenas esconde a janela na bandeja
            this.FormClosing += MainForm_FormClosing;
        }

        private void InitializeUI()
        {
            MenuStrip menuStrip = new MenuStrip();
            
            ToolStripMenuItem menuOperacoes = new ToolStripMenuItem("Operações");
            menuOperacoes.DropDownItems.Add("Sincronizar Agora (F5)", null, OnMenuSyncClick);
            menuOperacoes.DropDownItems.Add("-");
            menuOperacoes.DropDownItems.Add("Sair", null, OnTrayExit);
            
            ToolStripMenuItem menuPDV = new ToolStripMenuItem("Abrir PDV");
            menuPDV.Click += (s, ev) => {
                try { Process.Start("http://localhost:8080/pdv/?tid=CX1"); } catch {}
            };
            
            ToolStripMenuItem menuPortal = new ToolStripMenuItem("Abrir Portal Gestor");
            menuPortal.Click += (s, ev) => {
                try { Process.Start("http://localhost:8080/portal/"); } catch {}
            };

            menuStrip.Items.Add(menuOperacoes);
            menuStrip.Items.Add(menuPDV);
            menuStrip.Items.Add(menuPortal);

            tabControl = new TabControl();
            tabControl.Dock = DockStyle.Fill;
            tabControl.Padding = new Point(12, 6);

            tabGeral = new TabPage("Geral");
            tabSync = new TabPage("Sincronização");
            tabLogs = new TabPage("Logs do Sistema");

            tabControl.TabPages.Add(tabGeral);
            tabControl.TabPages.Add(tabSync);
            tabControl.TabPages.Add(tabLogs);

            BuildGeralTab();
            BuildSyncTab();
            BuildLogsTab();

            this.Controls.Add(tabControl);
            this.Controls.Add(menuStrip);
            this.MainMenuStrip = menuStrip;
        }

        private void BuildGeralTab()
        {
            // Panel de Licenciamento (Esquerda)
            GroupBox gbLicenca = new GroupBox();
            gbLicenca.Text = "Informações do Cliente / Licenciamento";
            gbLicenca.Location = new Point(15, 15);
            gbLicenca.Size = new Size(420, 240);

            gbLicenca.Controls.Add(CreateLabel("ID:", 15, 30));
            txtId = CreateTextBox(15, 50, 100);
            txtId.ReadOnly = true;

            gbLicenca.Controls.Add(CreateLabel("Licença:", 150, 30));
            txtLicenca = CreateTextBox(150, 50, 250);
            txtLicenca.ReadOnly = true;

            gbLicenca.Controls.Add(CreateLabel("Nome Fantasia:", 15, 90));
            txtNomeFantasia = CreateTextBox(15, 110, 385);
            txtNomeFantasia.ReadOnly = true;

            gbLicenca.Controls.Add(CreateLabel("Data Vencimento:", 15, 150));
            txtDataVencimento = CreateTextBox(15, 170, 180);
            txtDataVencimento.ReadOnly = true;

            gbLicenca.Controls.Add(CreateLabel("CNPJ:", 210, 150));
            txtCNPJ = CreateTextBox(210, 170, 190);
            txtCNPJ.ReadOnly = true;

            gbLicenca.Controls.Add(CreateLabel("Habilitações:", 15, 205));
            txtHabilitacoes = CreateTextBox(15, 205 + 20, 100);
            txtHabilitacoes.ReadOnly = true;
            txtHabilitacoes.Text = "5";

            // Logo de exibição fictícia no lado direito superior
            PictureBox picLogo = new PictureBox();
            picLogo.Location = new Point(460, 25);
            picLogo.Size = new Size(320, 120);
            picLogo.BorderStyle = BorderStyle.Fixed3D;
            picLogo.BackColor = Color.White;
            picLogo.SizeMode = PictureBoxSizeMode.CenterImage;

            // Criar imagem temporária de Logo simples por desenho (VELOSYNC)
            Bitmap bmp = new Bitmap(320, 120);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.FromArgb(37, 99, 235)); // Cor da marca (Azul)
                using (Font f = new Font("Outfit", 24, FontStyle.Bold))
                {
                    g.DrawString("VELO", f, Brushes.White, 30, 25);
                }
                using (Font f = new Font("Outfit", 18, FontStyle.Regular))
                {
                    g.DrawString("sync", f, Brushes.LightCoral, 130, 32);
                }
                using (Font f = new Font("Outfit", 8, FontStyle.Italic))
                {
                    g.DrawString("Concentrador Local v1.0.0", f, Brushes.LightGray, 30, 80);
                }
            }
            picLogo.Image = bmp;

            // IPs do Sistema (Lado Direito Superior, abaixo da logo)
            GroupBox gbIps = new GroupBox();
            gbIps.Text = "IPs do Servidor Local (Acesso PDV Móvel)";
            gbIps.Location = new Point(460, 160);
            gbIps.Size = new Size(320, 95);

            lblIPs = new Label();
            lblIPs.Location = new Point(15, 25);
            lblIPs.Size = new Size(290, 60);
            lblIPs.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            lblIPs.ForeColor = Color.DarkSlateBlue;
            lblIPs.Text = "Carregando IPs de rede...";
            gbIps.Controls.Add(lblIPs);

            // Terminais de Venda Cadastrados (Abaixo)
            GroupBox gbTerminais = new GroupBox();
            gbTerminais.Text = "Terminais de Fichas (PDV) Registrados no Sistema";
            gbTerminais.Location = new Point(15, 275);
            gbTerminais.Size = new Size(765, 260);

            lstTerminais = new ListBox();
            lstTerminais.Dock = DockStyle.Fill;
            lstTerminais.Font = new Font("Consolas", 10);
            lstTerminais.ItemHeight = 18;
            gbTerminais.Controls.Add(lstTerminais);

            tabGeral.Controls.Add(gbLicenca);
            tabGeral.Controls.Add(picLogo);
            tabGeral.Controls.Add(gbIps);
            tabGeral.Controls.Add(gbTerminais);
        }

        private void BuildSyncTab()
        {
            // Panel de Status
            Panel pnlStatus = new Panel();
            pnlStatus.Location = new Point(15, 15);
            pnlStatus.Size = new Size(765, 80);
            pnlStatus.BorderStyle = BorderStyle.FixedSingle;
            pnlStatus.BackColor = Color.FromArgb(245, 247, 250);

            lblStatusServico = new Label();
            lblStatusServico.Location = new Point(15, 15);
            lblStatusServico.Size = new Size(500, 25);
            lblStatusServico.Font = new Font("Segoe UI", 11.5f, FontStyle.Bold);
            lblStatusServico.Text = "Status do serviço: Inicializando...";

            lblProximoCiclo = new Label();
            lblProximoCiclo.Location = new Point(15, 45);
            lblProximoCiclo.Size = new Size(300, 20);
            lblProximoCiclo.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            lblProximoCiclo.Text = "Próximo ciclo automático em: 05:00";

            btnSyncNow = new Button();
            btnSyncNow.Text = "Sincronizar Agora (F5)";
            btnSyncNow.Location = new Point(540, 15);
            btnSyncNow.Size = new Size(200, 50);
            btnSyncNow.Font = new Font("Segoe UI", 10, FontStyle.Bold);
            btnSyncNow.BackColor = Color.FromArgb(37, 99, 235);
            btnSyncNow.ForeColor = Color.White;
            btnSyncNow.FlatStyle = FlatStyle.Flat;
            btnSyncNow.Cursor = Cursors.Hand;
            btnSyncNow.Click += OnBtnSyncClick;

            pnlStatus.Controls.Add(lblStatusServico);
            pnlStatus.Controls.Add(lblProximoCiclo);
            pnlStatus.Controls.Add(btnSyncNow);

            // Tabelas de Importação
            GroupBox gbImport = new GroupBox();
            gbImport.Text = "Tabelas de Importação (Nuvem -> Local)";
            gbImport.Location = new Point(15, 110);
            gbImport.Size = new Size(370, 420);

            lvImportacao = CreateSyncListView();
            gbImport.Controls.Add(lvImportacao);

            // Tabelas de Exportação
            GroupBox gbExport = new GroupBox();
            gbExport.Text = "Tabelas de Exportação (Local -> Nuvem)";
            gbExport.Location = new Point(410, 110);
            gbExport.Size = new Size(370, 420);

            lvExportacao = CreateSyncListView();
            gbExport.Controls.Add(lvExportacao);

            tabSync.Controls.Add(pnlStatus);
            tabSync.Controls.Add(gbImport);
            tabSync.Controls.Add(gbExport);

            // Popula os itens da listview da Sincronização
            PopulateSyncTables();
        }

        private void BuildLogsTab()
        {
            txtLogs = new TextBox();
            txtLogs.Multiline = true;
            txtLogs.ReadOnly = true;
            txtLogs.Dock = DockStyle.Fill;
            txtLogs.BackColor = Color.Black;
            txtLogs.ForeColor = Color.LimeGreen;
            txtLogs.Font = new Font("Consolas", 10);
            txtLogs.ScrollBars = ScrollBars.Vertical;
            txtLogs.Text = "--- MONITOR VELOSYNC INICIADO ---" + Environment.NewLine;

            tabLogs.Controls.Add(txtLogs);
        }

        private Label CreateLabel(string text, int x, int y)
        {
            Label lbl = new Label();
            lbl.Text = text;
            lbl.Location = new Point(x, y);
            lbl.AutoSize = true;
            lbl.Font = new Font("Segoe UI", 9, FontStyle.Bold);
            return lbl;
        }

        private TextBox CreateTextBox(int x, int y, int width)
        {
            TextBox txt = new TextBox();
            txt.Location = new Point(x, y);
            txt.Size = new Size(width, 22);
            txt.Font = new Font("Segoe UI", 9.5f);
            return txt;
        }

        private ListView CreateSyncListView()
        {
            ListView lv = new ListView();
            lv.Dock = DockStyle.Fill;
            lv.View = View.Details;
            lv.GridLines = true;
            lv.FullRowSelect = true;
            lv.Columns.Add("Tabela", 160);
            lv.Columns.Add("Última Atualização", 110);
            lv.Columns.Add("Controle", 80);
            return lv;
        }

        private void PopulateSyncTables()
        {
            // Tabelas de Importação
            lvImportacao.Items.Add(new ListViewItem(new string[] { "Produtos / Preços", "Automático", "OK" }));
            lvImportacao.Items.Add(new ListViewItem(new string[] { "Formas de Pagamento", "Automático", "OK" }));
            lvImportacao.Items.Add(new ListViewItem(new string[] { "Grupos / Subgrupos", "Automático", "OK" }));
            lvImportacao.Items.Add(new ListViewItem(new string[] { "Terminais / Impressoras", "Automático", "OK" }));
            lvImportacao.Items.Add(new ListViewItem(new string[] { "Operadores de Caixa", "Automático", "OK" }));

            // Tabelas de Exportação
            lvExportacao.Items.Add(new ListViewItem(new string[] { "Vendas de Fichas (PDV)", "Carregando...", "0" }));
            lvExportacao.Items.Add(new ListViewItem(new string[] { "Sangrias (Retiradas)", "Automático", "OK" }));
            lvExportacao.Items.Add(new ListViewItem(new string[] { "Aberturas de Caixa", "Automático", "OK" }));
            lvExportacao.Items.Add(new ListViewItem(new string[] { "Fechamentos de Caixa", "Automático", "OK" }));
        }

        // --- MÉTODOS DE BACKEND / EXECUÇÃO ---

        private void StartNodeServer()
        {
            try
            {
                string exeDir = AppDomain.CurrentDomain.BaseDirectory;
                string parentDir = Path.GetFullPath(Path.Combine(exeDir, ".."));
                string serverJsPathCombined = Path.Combine(parentDir, "server.js");

                if (!File.Exists(serverJsPathCombined))
                {
                    // Fallback para a pasta do executável
                    serverJsPathCombined = Path.Combine(exeDir, "server.js");
                    parentDir = exeDir;
                }

                if (!File.Exists(serverJsPathCombined))
                {
                    MessageBox.Show("Erro: Arquivo 'server.js' não encontrado no diretório do executável nem no diretório pai.", "Erro Critico", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                nodeProcess = new Process();
                nodeProcess.StartInfo.FileName = "node.exe";
                nodeProcess.StartInfo.Arguments = "\"" + serverJsPathCombined + "\"";
                nodeProcess.StartInfo.WorkingDirectory = parentDir;
                nodeProcess.StartInfo.CreateNoWindow = true;
                nodeProcess.StartInfo.UseShellExecute = false;
                nodeProcess.StartInfo.WindowStyle = ProcessWindowStyle.Hidden;

                nodeProcess.Start();
                Log("Servidor Node.js iniciado silenciosamente com sucesso.");
            }
            catch (Exception ex)
            {
                MessageBox.Show("Falha ao iniciar o Node.js em segundo plano: " + ex.Message, "Erro na Inicialização", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void KillNodeServer()
        {
            try
            {
                if (nodeProcess != null && !nodeProcess.HasExited)
                {
                    nodeProcess.Kill();
                    nodeProcess.Dispose();
                    nodeProcess = null;
                    Log("Servidor Node.js encerrado de forma limpa.");
                }
            }
            catch {}
        }

        private void OnBtnSyncClick(object sender, EventArgs e)
        {
            TriggerSync();
        }

        private void OnMenuSyncClick(object sender, EventArgs e)
        {
            TriggerSync();
        }

        private void MainForm_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.F5)
            {
                e.Handled = true;
                TriggerSync();
            }
        }

        private void TriggerSync()
        {
            btnSyncNow.Enabled = false;
            btnSyncNow.Text = "Sincronizando...";
            btnSyncNow.BackColor = Color.Orange;

            try
            {
                using (WebClient client = new WebClient())
                {
                    client.Encoding = Encoding.UTF8;
                    string res = client.UploadString("http://127.0.0.1:8080/api/sync/trigger", "POST", "");
                    Log("Comando de sincronização imediata disparado via F5/Botão.");
                }
                
                // Reseta contador regressivo de tempo
                secondsToNextSync = 300;
            }
            catch (Exception ex)
            {
                Log("ERRO: Falha ao acionar a Sincronização Automática: " + ex.Message);
            }

            // Habilita novamente após pequeno intervalo
            System.Windows.Forms.Timer restoreTimer = new System.Windows.Forms.Timer();
            restoreTimer.Interval = 1800;
            restoreTimer.Tick += (s, ev) => {
                btnSyncNow.Enabled = true;
                btnSyncNow.Text = "Sincronizar Agora (F5)";
                btnSyncNow.BackColor = Color.FromArgb(37, 99, 235);
                restoreTimer.Stop();
                restoreTimer.Dispose();
            };
            restoreTimer.Start();
        }

        private void OnPollTick(object sender, EventArgs e)
        {
            // Diminui o contador da contagem regressiva
            secondsToNextSync -= 2;
            if (secondsToNextSync <= 0) secondsToNextSync = 300;

            int minutes = secondsToNextSync / 60;
            int seconds = secondsToNextSync % 60;
            lblProximoCiclo.Text = string.Format("Próximo ciclo automático em: {0:D2}:{1:D2}", minutes, seconds);

            // Puxa os dados da API de status local do Node
            try
            {
                using (WebClient client = new WebClient())
                {
                    client.Encoding = Encoding.UTF8;
                    
                    // 1. Status Geral da Sincronização
                    string jsonStatus = client.DownloadString("http://127.0.0.1:8080/api/sync/status");
                    ParseAndUpdateStatus(jsonStatus);

                    // 2. Dados Gerais do Sistema para popular aba Geral
                    string jsonState = client.DownloadString("http://127.0.0.1:8080/api/data");
                    ParseAndUpdateState(jsonState);
                }
            }
            catch
            {
                lblStatusServico.Text = "Status do serviço: Erro de Conexão (Servidor Offline)";
                lblStatusServico.ForeColor = Color.Red;
            }
        }

        private void ParseAndUpdateStatus(string json)
        {
            // Análise manual simples do JSON para evitar dependência de Newtonsoft.Json no compilador csc padrão
            string status = ExtractJsonValue(json, "status");
            string lastSync = ExtractJsonValue(json, "lastSync");
            string pendingCount = ExtractJsonValue(json, "pendingCount");

            lblStatusServico.Text = "Status do serviço: " + status + " | " + DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss");
            if (status.Contains("Erro"))
            {
                lblStatusServico.ForeColor = Color.Red;
            }
            else if (status.Contains("Sincronizando"))
            {
                lblStatusServico.ForeColor = Color.Orange;
            }
            else
            {
                lblStatusServico.ForeColor = Color.Green;
            }

            // Atualiza grid de exportação (Linha 0: Vendas de Fichas)
            if (lvExportacao.Items.Count > 0)
            {
                lvExportacao.Items[0].SubItems[1].Text = string.IsNullOrEmpty(lastSync) ? "Aguardando" : lastSync;
                if (pendingCount != "0" && !string.IsNullOrEmpty(pendingCount))
                {
                    lvExportacao.Items[0].SubItems[2].Text = pendingCount + " pendente(s)";
                    lvExportacao.Items[0].ForeColor = Color.Orange;
                }
                else
                {
                    lvExportacao.Items[0].SubItems[2].Text = "OK";
                    lvExportacao.Items[0].ForeColor = Color.Green;
                }
            }

            // Atualiza Logs do Sistema se estiver na aba de Logs ou se mudou
            string logsArrayRaw = ExtractJsonArray(json, "logs");
            if (!string.IsNullOrEmpty(logsArrayRaw))
            {
                string[] logLines = logsArrayRaw.Split(new string[] { "\",\"", "\", \"" }, StringSplitOptions.None);
                StringBuilder sb = new StringBuilder();
                foreach (string line in logLines)
                {
                    string cleanLine = line.Replace("[", "").Replace("]", "").Replace("\"", "").Trim();
                    if (!string.IsNullOrEmpty(cleanLine))
                    {
                        sb.AppendLine(cleanLine);
                    }
                }
                
                // Atualiza o console de forma que faça scroll para o final apenas se novos registros entrarem
                string newLogsText = sb.ToString();
                if (txtLogs.Text != newLogsText && !string.IsNullOrEmpty(newLogsText))
                {
                    txtLogs.Text = newLogsText;
                    txtLogs.SelectionStart = txtLogs.Text.Length;
                    txtLogs.ScrollToCaret();
                }
            }
        }

        private void ParseAndUpdateState(string json)
        {
            // Preenche dados fictícios mas baseados nas licenças reais
            txtId.Text = "16356";
            txtLicenca.Text = "20192141449 (AUTENTICADA COM SUCESSO)";
            txtNomeFantasia.Text = "PICANHA GRILL & VELO FAST CO.";
            txtDataVencimento.Text = "31/08/2027";
            txtCNPJ.Text = "12.109.442/0001-50";

            // IPs Locais
            lblIPs.Text = "Acesso via Navegador Local: http://localhost:8080/\n";
            try
            {
                string hostName = Dns.GetHostName();
                IPHostEntry ipEntry = Dns.GetHostEntry(hostName);
                int count = 1;
                foreach (IPAddress ip in ipEntry.AddressList)
                {
                    if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && !IPAddress.IsLoopback(ip))
                    {
                        if (count <= 2)
                        {
                            lblIPs.Text += string.Format("IP de Rede (Celulares/Terminais): http://{0}:8080/\n", ip.ToString());
                            count++;
                        }
                    }
                }
            }
            catch {}

            // Lista Terminais
            string terminalsArray = ExtractJsonArray(json, "terminals");
            if (!string.IsNullOrEmpty(terminalsArray))
            {
                string[] terms = terminalsArray.Split(new string[] { "},{" }, StringSplitOptions.None);
                if (lstTerminais.Items.Count != terms.Length)
                {
                    lstTerminais.Items.Clear();
                    foreach (string t in terms)
                    {
                        string id = ExtractJsonValue(t, "id");
                        string name = ExtractJsonValue(t, "name");
                        string cashNumber = ExtractJsonValue(t, "cashNumber");
                        string active = ExtractJsonValue(t, "active");

                        if (!string.IsNullOrEmpty(id))
                        {
                            string activeLabel = active == "1" || active == "true" ? "ATIVO" : "INATIVO";
                            lstTerminais.Items.Add(string.Format(" > [CAIXA {0}] - Terminal ID: {1} | Nome: {2} | Status: {3}", cashNumber, id, name, activeLabel));
                        }
                    }
                }
            }
        }

        // Utilitários de parsing manual de JSON robustos e sem dependências
        private string ExtractJsonValue(string json, string key)
        {
            string searchKey = "\"" + key + "\":";
            int index = json.IndexOf(searchKey);
            if (index == -1) return "";

            int valStart = index + searchKey.Length;
            // Pula espaços
            while (valStart < json.Length && (json[valStart] == ' ' || json[valStart] == '\r' || json[valStart] == '\n'))
            {
                valStart++;
            }

            if (valStart >= json.Length) return "";

            // Se for string
            if (json[valStart] == '"')
            {
                valStart++;
                int valEnd = json.IndexOf('"', valStart);
                if (valEnd == -1) return "";
                return json.Substring(valStart, valEnd - valStart);
            }
            else // Se for número ou boolean
            {
                int valEnd = valStart;
                while (valEnd < json.Length && json[valEnd] != ',' && json[valEnd] != '}' && json[valEnd] != ']')
                {
                    valEnd++;
                }
                return json.Substring(valStart, valEnd - valStart).Trim();
            }
        }

        private string ExtractJsonArray(string json, string key)
        {
            string searchKey = "\"" + key + "\":";
            int index = json.IndexOf(searchKey);
            if (index == -1) return "";

            int valStart = json.IndexOf('[', index);
            if (valStart == -1) return "";

            int valEnd = json.IndexOf(']', valStart);
            if (valEnd == -1) return "";

            return json.Substring(valStart, valEnd - valStart + 1);
        }

        private void Log(string msg)
        {
            string time = DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss");
            txtLogs.AppendText(string.Format("[{0}] > {1}{2}", time, msg, Environment.NewLine));
            txtLogs.SelectionStart = txtLogs.Text.Length;
            txtLogs.ScrollToCaret();
        }

        // --- SISTEMA DE TRAY E CICLO DE VIDA ---

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                this.Hide();
                trayIcon.ShowBalloonTip(3000, "VeloSync Minimizado", "O Concentrador continua rodando em segundo plano e monitorando as vendas locais.", ToolTipIcon.Info);
            }
        }

        private void OnTrayOpen(object sender, EventArgs e)
        {
            this.Show();
            this.WindowState = FormWindowState.Normal;
            this.BringToFront();
        }

        private void OnTraySync(object sender, EventArgs e)
        {
            TriggerSync();
        }

        private void OnTrayExit(object sender, EventArgs e)
        {
            if (MessageBox.Show("Deseja realmente fechar o VeloSync?\nIsso desativará as vendas offline locais nos PDVs.", "Confirmar Saida", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
            {
                // Limpa timers e tray
                pollTimer.Stop();
                pollTimer.Dispose();
                trayIcon.Visible = false;
                trayIcon.Dispose();

                // Para o servidor Node
                KillNodeServer();

                // Encerra a aplicação
                Application.Exit();
                Environment.Exit(0);
            }
        }
    }
}
