// Seleciona o sino, dot vermelho e modal
const bellIcon = document.querySelector('.notification-bell');
const notificationDot = document.querySelector('.notification-dot');
const newsModal = document.getElementById('newsModal');

// Abre o modal ao clicar no sino
bellIcon.addEventListener('click', (event) => {
    event.stopPropagation(); // Previne o fechamento imediato
    if (newsModal.style.left === "0px") { // Verifica se o modal já está visível
        // Fecha o modal
        newsModal.style.left = "-100%"; // Move para a esquerda
        notificationDot.classList.remove('hidden'); // Mostra o ponto de notificação
    } else {
        // Abre o modal
        newsModal.style.left = "0"; // Move para a posição visível
        notificationDot.classList.add('hidden'); // Esconde o ponto de notificação
    }
});

// Fecha o modal ao clicar fora dele
window.addEventListener('click', (event) => {
    if (!newsModal.contains(event.target) && !bellIcon.contains(event.target)) {
        // Fecha o modal
        newsModal.style.left = "-100%"; // Move para a esquerda
        notificationDot.classList.remove('hidden'); // Mostra o ponto de notificação
    }
});

// Impede o fechamento do modal ao clicar dentro dele
newsModal.addEventListener('click', (event) => {
    event.stopPropagation(); // Previne o fechamento quando clicar dentro do modal
});
