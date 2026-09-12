(function () {
    const pixelId = 'REPLACE_WITH_META_PIXEL_ID';
    const isConfigured = /^\d{8,}$/.test(pixelId);

    window.viveMetaPixel = {
        configured: isConfigured,
        track: function (eventName, parameters) {
            if (!isConfigured || typeof window.fbq !== 'function') return;
            window.fbq('track', eventName, parameters || {});
        },
        trackCustom: function (eventName, parameters) {
            if (!isConfigured || typeof window.fbq !== 'function') return;
            window.fbq('trackCustom', eventName, parameters || {});
        }
    };

    if (!isConfigured || window.__viveDeutschMetaPixelLoaded) return;
    window.__viveDeutschMetaPixelLoaded = true;

    !function (f, b, e, v, n, t, s) {
        if (f.fbq) return;
        n = f.fbq = function () {
            n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n;
        n.push = n;
        n.loaded = true;
        n.version = '2.0';
        n.queue = [];
        t = b.createElement(e);
        t.async = true;
        t.src = v;
        s = b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('init', pixelId);
    window.fbq('track', 'PageView');

    const trackClick = function (selector, eventName, parameters, custom) {
        document.querySelectorAll(selector).forEach(function (element) {
            element.addEventListener('click', function () {
                if (custom) {
                    window.viveMetaPixel.trackCustom(eventName, parameters);
                } else {
                    window.viveMetaPixel.track(eventName, parameters);
                }
            });
        });
    };

    document.addEventListener('DOMContentLoaded', function () {
        trackClick('.school-whatsapp-link', 'Contact', {
            content_name: 'WhatsApp Ralph',
            content_category: 'german_classes'
        });
        trackClick('.angela-whatsapp-link', 'Contact', {
            content_name: 'WhatsApp Angela',
            content_category: 'language_services'
        });
        trackClick('.setmore-open, a[href*="ralphrudiger.setmore.com"]', 'Schedule', {
            content_name: 'Setmore booking',
            content_category: 'german_classes'
        });
        trackClick('a[href*="instagram.com/vivedeutschmx"]', 'SocialProfileClick', {
            platform: 'instagram'
        }, true);
        trackClick('a[href*="facebook.com/vivedeutschmx"]', 'SocialProfileClick', {
            platform: 'facebook'
        }, true);
    });
})();
