const el = {
    dialogModal: document.getElementById("dialogModal"),
    btnAbrir: document.getElementById("btnAbrir"),
    btnFechar: document.getElementById("btnFechar")
}
el.btnAbrir.addEventListener("click", () =>{
    el.dialogModal.showModal();
});
el.btnFechar.addEventListener("click", () =>{
    el.dialogModal.close();
});