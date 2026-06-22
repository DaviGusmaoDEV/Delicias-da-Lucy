console.log('Diretório atual:', process.cwd());
console.log('Arquivos aqui:', require('fs').readdirSync('.'));

require('dotenv').config();
const express = require('express');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');

const app = express();

app.use(helmet());
app.use(cors()); 
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'chave-muito-segura';

// Middleware de Autenticação
const autenticar = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ erro: 'Token ausente' });
    
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch { 
        res.status(403).json({ erro: 'Token inválido ou expirado' }); 
    }
};

// --- ROTAS DE LOGIN E PERFIL ---
app.post('/api/login', async (req, res) => {
    const { identificador, senha } = req.body;
    const ehEmail = identificador.includes('@');
    const colunaBusca = ehEmail ? 'email' : 'nome';

    const { data: usuario, error } = await supabase
        .from('profiles')
        .select('*')
        .eq(colunaBusca, identificador.trim())
        .single();

    if (error || usuario.senha !== senha.trim()) 
        return res.status(401).json({ erro: 'Credenciais inválidas.' });

    const token = jwt.sign({ id: usuario.id, role: usuario.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, role: usuario.role, nome: usuario.nome });
});

app.get('/api/meu-perfil', autenticar, async (req, res) => {
    const { data: perfil, error } = await supabase.from('profiles').select('nome, email').eq('id', req.user.id).single();
    if (error) return res.status(404).json({ erro: "Perfil não encontrado." });
    res.json({ perfil });
});

// --- ROTAS DE PRODUTOS ---
app.get('/api/produtos', autenticar, async (req, res) => {
    const { data, error } = await supabase.from('products').select('*');
    if (error) return res.status(400).json({ erro: error.message });
    res.json(data);
});

app.post('/api/produtos', autenticar, async (req, res) => {
    if (req.user.role !== 'admin1' && req.user.role !== 'admin2') return res.status(403).json({ erro: 'Acesso negado.' });
    const { nome, preco, descricao, imagem_url, isEspecial } = req.body;
    const { data, error } = await supabase.from('products').insert([{ nome, preco, descricao, imagem_url, isEspecial }]);
    if (error) return res.status(400).json({ erro: error.message });
    res.status(201).json({ mensagem: "Produto cadastrado!", data });
});

// --- ROTAS DE FLUXO DE CAIXA (ADMIN 2 ONLY) ---
app.get('/api/fluxo-caixa', autenticar, async (req, res) => {
    if (req.user.role !== 'admin2') return res.status(403).json({ erro: 'Acesso negado: Apenas Gerente.' });
    const { data, error } = await supabase.from('fluxo_caixa').select('*').order('data', { ascending: false });
    if (error) return res.status(400).json({ erro: error.message });
    res.json(data);
});

app.post('/api/fluxo-caixa', autenticar, async (req, res) => {
    if (req.user.role !== 'admin2') return res.status(403).json({ erro: 'Acesso negado: Apenas Gerente.' });
    const { descricao, tipo, valor, data } = req.body;
    const { data: nova, error } = await supabase.from('fluxo_caixa').insert([{ descricao, tipo, valor, data }]);
    if (error) return res.status(400).json({ erro: error.message });
    res.status(201).json(nova);
});

app.delete('/api/fluxo-caixa/:id', autenticar, async (req, res) => {
    if (req.user.role !== 'admin2') return res.status(403).json({ erro: 'Acesso negado: Apenas Gerente.' });
    const { error } = await supabase.from('fluxo_caixa').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ erro: error.message });
    res.json({ mensagem: "Excluído com sucesso" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));