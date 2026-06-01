import sys
import json

def processar():
    try:
        # 1. Lê a string JSON enviada pelo Node.js
        linhas_entrada = sys.stdin.read()
        if not linhas_entrada:
            print(json.dumps({"erro": "Nenhum dado recebido pelo script Python"}))
            return

        dados = json.loads(linhas_entrada)

        # ----------------------------------------------------
        # EXEMPO DE LÓGICA DE GERENCIAMENTO / FLUXO DE CAIXA:
        # Se você passar do front ex: { "tipo": "fluxo_caixa", "valores": [10, 20, 30] }
        # ----------------------------------------------------
        
        # Monte sua resposta em formato de dicionário Python
        resposta = {
            "status": "sucesso",
            "mensagem": "Dados processados em Python com sucesso!",
            "dados_recebidos": dados
        }

        # 2. Devolve para o Node imprimindo o JSON na tela
        print(json.dumps(resposta))

    except Exception as e:
        print(json.dumps({"erro": str(e)}))

if __name__ == '__main__':
    processar()