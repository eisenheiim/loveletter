const fs = require('fs/promises');
const path = require('path');
const cheerio = require('cheerio');
const { getMusicSrc } = require('./music');

const TEMPLATE_PATH = path.join(__dirname, '..', 'index.html');

let cachedTemplate = null;

async function loadTemplate() {
  if (!cachedTemplate) {
    cachedTemplate = await fs.readFile(TEMPLATE_PATH, 'utf8');
  }
  return cachedTemplate;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMessageHtml(message) {
  return escapeHtml(message)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('<br />\n            ');
}

/**
 * Populate index.html with surprise data from the database.
 */
async function renderSurprisePage(site, baseUrl) {
  const html = await loadTemplate();
  const $ = cheerio.load(html, { decodeEntities: false });

  $('title').text(`For ${site.partnerName}, Always`);

  $('.hero-title-name').text(site.partnerName || 'Favorite Person');

  const messageHtml = formatMessageHtml(
    site.mainMessage || 'In a world of ordinary moments, you are my most beautiful forever.'
  );
  $('.hero-body').html(messageHtml);

  $('#climax p.font-serif.text-3xl.text-wine').text(`${site.senderName || 'Your Name Here'} ♥`);

  const photoSlots = $('.photo-placeholder').toArray();
  const storyImages = (site.images || []).slice(0, 4);
  storyImages.forEach((imagePath, index) => {
    if (!photoSlots[index]) return;
    const src = imagePath.startsWith('http')
      ? imagePath
      : `${baseUrl.replace(/\/$/, '')}/${imagePath.replace(/^\//, '')}`;

    const $slot = $(photoSlots[index]);
    $slot.empty();
    $slot.append(
      `<img src="${escapeHtml(src)}" alt="Memory ${index + 1}" class="w-full h-full object-cover" />`
    );
    $slot.removeClass('flex items-center justify-center');
  });

  const puzzleImage = (site.images || [])[4];
  if (puzzleImage) {
    const puzzleSrc = puzzleImage.startsWith('http')
      ? puzzleImage
      : `${baseUrl.replace(/\/$/, '')}/${puzzleImage.replace(/^\//, '')}`;
    $('body').attr('data-puzzle-image', puzzleSrc);
  }

  const loveCards = $('#reasons-cards .love-card-back p').toArray();
  const points = site.lovePoints || [];
  points.forEach((point, index) => {
    if (!loveCards[index]) return;
    $(loveCards[index]).html(`&ldquo;${escapeHtml(point)}&rdquo;`);
  });

  const musicSrc = getMusicSrc(site.musicTrack);
  if (musicSrc) {
    $('#bg-audio source').attr('src', musicSrc);
    $('#bg-audio').attr('src', musicSrc);
  } else {
    $('#music-toggle').remove();
    $('#bg-audio').remove();
  }

  return $.html();
}

module.exports = { renderSurprisePage };
