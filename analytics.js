(function () {
    const measurementId = 'G-07SGVPMFHL';

    if (window.__viveDeutschGaLoaded) return;
    window.__viveDeutschGaLoaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () {
        window.dataLayer.push(arguments);
    };

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
    document.head.appendChild(script);

    window.gtag('js', new Date());
    window.gtag('config', measurementId);
})();
