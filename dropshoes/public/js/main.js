// main.js
import { realizarLogin } from './login.js';
import { adicionarAoCarrinho } from './carrinho.js';

// Exemplo de execução estruturada de teste
document.addEventListener("DOMContentLoaded", async () => {
    console.log("Sistema Delícias da Lucy inicializado via ES Modules.");
    
    // Teste controlado de fluxo (Remover ou comentar em produção se necessário)
    const logado = await realizarLogin("admin", "123");
    if (logado) {
        const produtoTeste = { id: 1, nome: "Bolo de Pote Premium", preco: 12.50 };
        adicionarAoCarrinho(produtoTeste);
    }
});