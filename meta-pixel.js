(function () {
    const pixelId = '1091890316575368';
    const isConfigured = /^\d{8,}$/.test(pixelId);
    const hasMarketingConsent = function () {
        return Boolean(window.viveConsent && window.viveConsent.allows('marketing'));
    };

    window.viveMetaPixel = {
        configured: isConfigured,
        track: function (eventName, parameters) {
            if (!isConfigured || !hasMarketingConsent() || typeof window.fbq !== 'function') return;
            window.fbq('track', eventName, parameters || {});
        },
        trackCustom: function (eventName, parameters) {
            if (!isConfigured || !hasMarketingConsent() || typeof window.fbq !== 'function') return;
            window.fbq('trackCustom', eventName, parameters || {});
        }
    };

    const loadPixel = function () {
        if (!isConfigured || !hasMarketingConsent() || window.__viveDeutschMetaPixelLoaded) return;
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
        window.fbq('consent', 'grant');
        window.fbq('track', 'PageView');
    };

    loadPixel();
    window.addEventListener('vive:consentchange', function () {
        if (hasMarketingConsent()) {
            loadPixel();
        } else if (typeof window.fbq === 'function') {
            window.fbq('consent', 'revoke');
        }
    });

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
        // A click opens the provider; it does not confirm a conversation or booking.
        trackClick('.school-whatsapp-link', 'WhatsAppClick', {
            content_name: 'WhatsApp Ralph',
            content_category: 'german_classes'
        }, true);
        trackClick('.angela-whatsapp-link', 'WhatsAppClick', {
            content_name: 'WhatsApp Angela',
            content_category: 'language_services'
        }, true);
        trackClick('.setmore-open, a[href*="ralphrudiger.setmore.com"]', 'BookingClick', {
            content_name: 'Setmore booking',
            content_category: 'german_classes'
        }, true);
        trackClick('a[href*="instagram.com/vivedeutschmx"]', 'SocialProfileClick', {
            platform: 'instagram'
        }, true);
        trackClick('a[href*="facebook.com/vivedeutschmx"]', 'SocialProfileClick', {
            platform: 'facebook'
        }, true);
    });
})();
