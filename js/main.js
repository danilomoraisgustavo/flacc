
const $ = (s, x=document)=>x.querySelector(s);
const $$ = (s, x=document)=>x.querySelectorAll(s);

const menuBtn = $('#menu-btn');
const menu = $('#menu');
if(menuBtn){
  menuBtn.addEventListener('click', ()=>{
    const isOpen = menu.getAttribute('data-open') === 'true';
    menu.setAttribute('data-open', String(!isOpen));
    menu.hidden = isOpen;
    menuBtn.setAttribute('aria-expanded', String(!isOpen));
  });
}

const lb = $('#lightbox');
if(lb){
  $$('.gallery img').forEach(img=>{
    img.addEventListener('click', ()=>{
      const big = img.getAttribute('data-full') || img.src;
      $('#lightbox-img').src = big;
      lb.setAttribute('aria-hidden','false');
    });
  });
  lb.addEventListener('click', (e)=>{
    if(e.target === lb){ lb.setAttribute('aria-hidden','true'); }
  });
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape') lb.setAttribute('aria-hidden','true');
  });
}

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!reduced){
  $$('a[href^="#"]').forEach(a=>{
    a.addEventListener('click', e=>{
      const id = a.getAttribute('href').slice(1);
      const el = document.getElementById(id);
      if(el){ e.preventDefault(); el.scrollIntoView({behavior:'smooth', block:'start'}); }
    });
  });
}
