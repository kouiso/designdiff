import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

import { chromium } from "playwright";

const root = resolve("dist/web");
const screenshot =
  process.env.WHITE_THEME_SMOKE_SCREENSHOT ?? "/tmp/designdiff-white-browser-smoke.png";
const mobileScreenshot = screenshot.replace(/(\.[^.]+)?$/, "-mobile$1");
const themeNameIncludes = ["テーマ", "ダーク", "Theme", "Dark"];

const contentType = (path) =>
  ({
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  })[extname(path)] ?? "application/octet-stream";

const fail = (message, details) => {
  process.stderr.write(`${message}\n`);
  if (details) process.stderr.write(`${JSON.stringify(details, null, 2)}\n`);
  process.exit(1);
};

const pngMetadata = (buffer) => {
  const isPng =
    buffer.length > 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;

  return {
    isPng,
    width: isPng ? buffer.readUInt32BE(16) : 0,
    height: isPng ? buffer.readUInt32BE(20) : 0,
  };
};

const includesAny = (value, keywords) => keywords.some((keyword) => value.includes(keyword));
const isLightRadio = (radio) => includesAny(radio.name, ["ライト", "Light"]);
const isDarkRadio = (radio) => includesAny(radio.name, ["ダーク", "Dark"]);
const failureIf = (condition, message) => (condition ? message : null);
const focusableSelector =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const rgbChannels = (value) =>
  value
    .match(/\d+(\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number) ?? [];
const isBrightColor = (value) => {
  const [red, green, blue] = rgbChannels(value);
  return [red, green, blue].every((channel) => typeof channel === "number" && channel >= 245);
};
const isPathInside = (parent, child) => {
  const relativePath = relative(parent, child);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !isAbsolute(relativePath);
};

if (!existsSync(resolve(root, "index.html"))) {
  fail("dist/web/index.html is missing. Run build:web before smoke:white-theme.");
}

const installBundleRoute = async (page) => {
  await page.route("http://figdiff.local/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = resolve(root, `.${pathname}`);

    if (!isPathInside(root, file) || !existsSync(file)) {
      await route.fulfill({ status: 404, body: "not found" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: contentType(file),
      body: readFileSync(file),
    });
  });
};

const interactiveTargetAudit = async (page, rootSelector = "body") =>
  page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const elements = [
      ...new Set(
        [
          ...(root?.querySelectorAll("button, a[href], [role='button'], [role='radio']") ?? []),
        ].filter((element) => element instanceof HTMLElement),
      ),
    ];
    const targets = elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true"
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const accessibleName =
          element.getAttribute("aria-label") ||
          element.textContent?.replace(/\s+/g, " ").trim() ||
          "";
        return {
          name: accessibleName.slice(0, 40),
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          hasAccessibleName: Boolean(accessibleName),
        };
      });

    return {
      visibleTargetCount: targets.length,
      unnamedTargets: targets.filter((target) => !target.hasAccessibleName),
      tooSmallTargets: targets.filter((target) => target.width < 24 || target.height < 24),
    };
  }, rootSelector);

const focusVisibilityAudit = async (page, steps, rootSelector = "body") => {
  const results = [];

  for (let index = 0; index < steps; index += 1) {
    await page.keyboard.press("Tab");
    results.push(
      await page.evaluate((selector) => {
        const root = document.querySelector(selector);
        const active = document.activeElement;

        if (!(active instanceof HTMLElement) || !root?.contains(active)) {
          return {
            name: "outside-root",
            visibleFocus: false,
            inRoot: false,
          };
        }

        const rect = active.getBoundingClientRect();
        const style = getComputedStyle(active);
        const outlineWidth = Number.parseFloat(style.outlineWidth || "0");
        const hasOutline =
          style.outlineStyle !== "none" &&
          (outlineWidth > 0 || style.outlineStyle === "auto") &&
          style.outlineColor !== "transparent";
        const hasBoxShadow = style.boxShadow !== "none";

        return {
          name:
            active.getAttribute("aria-label") ||
            active.textContent?.replace(/\s+/g, " ").trim().slice(0, 40) ||
            active.getAttribute("role") ||
            active.tagName.toLowerCase(),
          visibleFocus: rect.width > 0 && rect.height > 0 && (hasOutline || hasBoxShadow),
          inRoot: true,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          boxShadow: style.boxShadow,
        };
      }, rootSelector),
    );
  }

  return {
    focusStepCount: results.filter((result) => result.inRoot).length,
    missingVisibleFocus: results.filter((result) => result.inRoot && !result.visibleFocus),
  };
};

const formControlLabelAudit = async (page, rootSelector = "body") =>
  page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const labelledByText = (element) =>
      (element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
    const explicitLabelText = (element) => {
      const id = element.getAttribute("id");
      if (!id) return "";
      return (
        root
          ?.querySelector(`label[for="${CSS.escape(id)}"]`)
          ?.textContent?.replace(/\s+/g, " ")
          .trim() ?? ""
      );
    };
    const controls = [
      ...(root?.querySelectorAll(
        'input:not([type="hidden"]), textarea, select, [role="slider"], [role="combobox"], [role="textbox"]',
      ) ?? []),
    ]
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          element.getAttribute("aria-hidden") !== "true"
        );
      })
      .map((element) => {
        const accessibleName =
          element.getAttribute("aria-label") ||
          labelledByText(element) ||
          explicitLabelText(element) ||
          element.closest("label")?.textContent?.replace(/\s+/g, " ").trim() ||
          "";

        return {
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute("type"),
          role: element.getAttribute("role"),
          id: element.getAttribute("id"),
          name: accessibleName.slice(0, 40),
          hasAccessibleName: Boolean(accessibleName),
        };
      });

    return {
      formControlCount: controls.length,
      unlabeledFormControls: controls.filter((control) => !control.hasAccessibleName),
    };
  }, rootSelector);

const duplicateIdAudit = async (page, rootSelector = "body") =>
  page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const ids = [...(root?.querySelectorAll("[id]") ?? [])]
      .map((element) => element.getAttribute("id") ?? "")
      .filter(Boolean);
    const counts = ids.reduce((accumulator, id) => {
      accumulator[id] = (accumulator[id] ?? 0) + 1;
      return accumulator;
    }, {});

    return {
      idCount: ids.length,
      duplicateIds: Object.entries(counts)
        .filter(([, count]) => count > 1)
        .map(([id, count]) => ({ id, count })),
    };
  }, rootSelector);

const smokeViewport = async (browser, viewport, screenshotPath) => {
  const page = await browser.newPage({ viewport });
  const errors = [];
  const settingsScreenshot = screenshotPath.replace(/(\.[^.]+)?$/, "-settings$1");
  const postCloseScreenshot = screenshotPath.replace(/(\.[^.]+)?$/, "-post-close$1");

  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });

  await installBundleRoute(page);
  await page.goto("http://figdiff.local/", { waitUntil: "networkidle" });
  const screenshotBuffer = await page.screenshot({ path: screenshotPath, fullPage: true });
  const screenshotImage = pngMetadata(screenshotBuffer);

  const result = await page.evaluate((themeKeywords) => {
    const contrastRatio = (foreground, background) => {
      const channels = (value) =>
        value
          .match(/\d+(\.\d+)?/g)
          ?.slice(0, 3)
          .map(Number) ?? [];
      const luminance = (color) => {
        const [red, green, blue] = channels(color).map((value) => {
          const normalized = value / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });

        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      const lighter = Math.max(foregroundLuminance, backgroundLuminance);
      const darker = Math.min(foregroundLuminance, backgroundLuminance);

      return (lighter + 0.05) / (darker + 0.05);
    };
    const effectiveBackgroundColor = (element) => {
      let current = element;
      while (current instanceof Element) {
        const backgroundColor = getComputedStyle(current).backgroundColor;
        if (
          !["rgba(0, 0, 0, 0)", "transparent"].includes(backgroundColor) &&
          !backgroundColor.includes(" / ")
        ) {
          return backgroundColor;
        }
        current = current.parentElement;
      }
      return getComputedStyle(document.documentElement).backgroundColor;
    };
    const contrastAudit = [...document.querySelectorAll("h1,h2,p,label,button")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          element.textContent?.trim() &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      })
      .map((element) => {
        const style = getComputedStyle(element);
        const backgroundColor = effectiveBackgroundColor(element);

        return {
          text: element.textContent?.trim().slice(0, 40) ?? "",
          color: style.color,
          backgroundColor,
          contrast: contrastRatio(style.color, backgroundColor),
        };
      });
    const htmlStyle = getComputedStyle(document.documentElement);
    const app = document.querySelector("#root > div");
    const appStyle = app ? getComputedStyle(app) : null;
    const headings = [...document.querySelectorAll("h1,h2")]
      .map((element) => element.textContent?.trim())
      .filter(Boolean);
    const version = [...document.querySelectorAll("p")]
      .map((element) => element.textContent?.trim())
      .find((text) => text?.startsWith("v"));
    const buttons = [...document.querySelectorAll("button")]
      .map((button) => ({
        name: button.getAttribute("aria-label") || button.textContent?.trim() || "",
        pressed: button.getAttribute("aria-pressed"),
      }))
      .filter((button) => themeKeywords.some((keyword) => button.name.includes(keyword)));
    const main = document.querySelector("main")?.getBoundingClientRect();

    return {
      appBg: appStyle?.backgroundColor ?? null,
      rootBg: htmlStyle.getPropertyValue("--bg").trim(),
      rootFg: htmlStyle.getPropertyValue("--fg").trim(),
      title: headings[0] ?? null,
      version: version ?? null,
      dark: document.documentElement.classList.contains("dark"),
      buttons,
      visibleTextCount: contrastAudit.length,
      lowContrastText: contrastAudit.filter((item) => item.contrast < 4.5),
      mainWidth: main ? Math.round(main.width) : 0,
      mainHeight: main ? Math.round(main.height) : 0,
      horizontalOverflow: document.body.scrollWidth > window.innerWidth,
    };
  }, themeNameIncludes);
  const homeTargetAudit = await interactiveTargetAudit(page);
  Object.assign(result, homeTargetAudit);
  const homeFocusAudit = await focusVisibilityAudit(page, result.visibleTargetCount);
  Object.assign(result, homeFocusAudit);
  const homeFormAudit = await formControlLabelAudit(page);
  Object.assign(result, homeFormAudit);
  const homeDuplicateIdAudit = await duplicateIdAudit(page);
  Object.assign(result, homeDuplicateIdAudit);

  const settingsButton = page.getByRole("button", { name: /^(設定|Settings)$/ });
  const settingsOpened = (await settingsButton.count()) > 0;
  if (settingsOpened) {
    await settingsButton.first().click();
  }

  if (settingsOpened) {
    await page.waitForSelector('[role="dialog"]', { timeout: 2000 });
    await page
      .waitForFunction(
        () => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog instanceof HTMLElement && dialog.contains(document.activeElement);
        },
        null,
        { timeout: 2000 },
      )
      .catch(() => undefined);
  }

  const settings = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const dialog = dialogs[0];
    const dialogRect = dialog?.getBoundingClientRect();
    const dialogStyle = dialog ? getComputedStyle(dialog) : null;
    const modal = dialog?.getAttribute("aria-modal") ?? "";
    const labelledById = dialog?.getAttribute("aria-labelledby") ?? "";
    const describedById = dialog?.getAttribute("aria-describedby") ?? "";
    const countById = (id) =>
      id ? document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length : 0;
    const textById = (id) => document.getElementById(id)?.textContent?.trim() ?? "";
    const label = textById(labelledById);
    const description = textById(describedById);
    const closeButtonLabel =
      dialog?.querySelector("button[aria-label]")?.getAttribute("aria-label") ?? "";
    const themeGroup = dialog?.querySelector('[role="radiogroup"]');
    const themeGroupLabel = themeGroup?.getAttribute("aria-label")?.trim() ?? "";
    const radios = [...(themeGroup?.querySelectorAll('[role="radio"]') ?? [])].map((radio) => ({
      name: radio.textContent?.trim() ?? "",
      checked: radio.getAttribute("aria-checked"),
    }));

    return {
      opened: Boolean(dialog),
      dialogCount: dialogs.length,
      bg: dialogStyle?.backgroundColor ?? null,
      modal,
      labelledById,
      describedById,
      labelledByCount: countById(labelledById),
      describedByCount: countById(describedById),
      label: label ?? "",
      description: description ?? "",
      closeButtonLabel: closeButtonLabel.trim(),
      activeElementInDialog: dialog ? dialog.contains(document.activeElement) : false,
      left: dialogRect ? Math.round(dialogRect.left) : 0,
      top: dialogRect ? Math.round(dialogRect.top) : 0,
      right: dialogRect ? Math.round(dialogRect.right) : 0,
      bottom: dialogRect ? Math.round(dialogRect.bottom) : 0,
      width: dialogRect ? Math.round(dialogRect.width) : 0,
      height: dialogRect ? Math.round(dialogRect.height) : 0,
      themeGroup: Boolean(themeGroup),
      themeGroupLabel,
      radios,
      horizontalOverflow: document.body.scrollWidth > window.innerWidth,
    };
  });
  const settingsTextContrast = settingsOpened
    ? await page.evaluate(() => {
        const contrastRatio = (foreground, background) => {
          const channels = (value) =>
            value
              .match(/\d+(\.\d+)?/g)
              ?.slice(0, 3)
              .map(Number) ?? [];
          const luminance = (color) => {
            const [red, green, blue] = channels(color).map((value) => {
              const normalized = value / 255;
              return normalized <= 0.03928
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            });

            return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          };
          const foregroundLuminance = luminance(foreground);
          const backgroundLuminance = luminance(background);
          const lighter = Math.max(foregroundLuminance, backgroundLuminance);
          const darker = Math.min(foregroundLuminance, backgroundLuminance);

          return (lighter + 0.05) / (darker + 0.05);
        };
        const effectiveBackgroundColor = (element) => {
          let current = element;
          while (current instanceof Element) {
            const backgroundColor = getComputedStyle(current).backgroundColor;
            if (
              !["rgba(0, 0, 0, 0)", "transparent"].includes(backgroundColor) &&
              !backgroundColor.includes(" / ")
            ) {
              return backgroundColor;
            }
            current = current.parentElement;
          }
          return getComputedStyle(document.documentElement).backgroundColor;
        };
        const dialog = document.querySelector('[role="dialog"]');
        const audit = [...(dialog?.querySelectorAll("h1,h2,p,label,button") ?? [])]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return (
              element.textContent?.trim() &&
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none"
            );
          })
          .map((element) => {
            const style = getComputedStyle(element);
            const backgroundColor = effectiveBackgroundColor(element);

            return {
              text: element.textContent?.trim().slice(0, 40) ?? "",
              color: style.color,
              backgroundColor,
              contrast: contrastRatio(style.color, backgroundColor),
            };
          });

        return {
          visibleTextCount: audit.length,
          lowContrastText: audit.filter((item) => item.contrast < 4.5),
        };
      })
    : {
        visibleTextCount: 0,
        lowContrastText: [],
      };
  Object.assign(settings, settingsTextContrast);
  const settingsTargetAudit = settingsOpened
    ? await interactiveTargetAudit(page, '[role="dialog"]')
    : {
        visibleTargetCount: 0,
        unnamedTargets: [],
        tooSmallTargets: [],
      };
  Object.assign(settings, settingsTargetAudit);
  const settingsFocusAudit = settingsOpened
    ? await focusVisibilityAudit(page, settings.visibleTargetCount, '[role="dialog"]')
    : {
        focusStepCount: 0,
        missingVisibleFocus: [],
      };
  Object.assign(settings, settingsFocusAudit);
  const settingsFormAudit = settingsOpened
    ? await formControlLabelAudit(page, '[role="dialog"]')
    : {
        formControlCount: 0,
        unlabeledFormControls: [],
      };
  Object.assign(settings, settingsFormAudit);
  const settingsDuplicateIdAudit = settingsOpened
    ? await duplicateIdAudit(page, '[role="dialog"]')
    : {
        idCount: 0,
        duplicateIds: [],
      };
  Object.assign(settings, settingsDuplicateIdAudit);
  const settingsScreenshotBuffer = await page.screenshot({
    path: settingsScreenshot,
    fullPage: true,
  });
  const settingsScreenshotImage = pngMetadata(settingsScreenshotBuffer);
  const settingsKeyboard = settingsOpened
    ? await (async () => {
        const canTestTrap = await page.evaluate((selector) => {
          const dialog = document.querySelector('[role="dialog"]');
          const focusable = dialog ? [...dialog.querySelectorAll(selector)] : [];
          const first = focusable[0];
          const last = focusable.at(-1);

          if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) {
            return false;
          }

          last.focus();
          return document.activeElement === last;
        }, focusableSelector);

        if (!canTestTrap) {
          return {
            canTestTrap,
            tabFromLastStayedInDialog: false,
            tabFromLastWrappedToFirst: false,
            shiftTabFromFirstStayedInDialog: false,
            shiftTabFromFirstWrappedToLast: false,
          };
        }

        await page.keyboard.press("Tab");
        const tabResult = await page.evaluate((selector) => {
          const dialog = document.querySelector('[role="dialog"]');
          const first = dialog?.querySelector(selector);

          return {
            stayedInDialog:
              dialog instanceof HTMLElement && dialog.contains(document.activeElement),
            wrappedToFirst: document.activeElement === first,
          };
        }, focusableSelector);

        await page.evaluate((selector) => {
          const dialog = document.querySelector('[role="dialog"]');
          const first = dialog?.querySelector(selector);
          if (first instanceof HTMLElement) first.focus();
        }, focusableSelector);
        await page.keyboard.press("Shift+Tab");
        const shiftTabResult = await page.evaluate((selector) => {
          const dialog = document.querySelector('[role="dialog"]');
          const focusable = dialog ? [...dialog.querySelectorAll(selector)] : [];
          const last = focusable.at(-1);

          return {
            stayedInDialog:
              dialog instanceof HTMLElement && dialog.contains(document.activeElement),
            wrappedToLast: document.activeElement === last,
          };
        }, focusableSelector);

        return {
          canTestTrap,
          tabFromLastStayedInDialog: tabResult.stayedInDialog,
          tabFromLastWrappedToFirst: tabResult.wrappedToFirst,
          shiftTabFromFirstStayedInDialog: shiftTabResult.stayedInDialog,
          shiftTabFromFirstWrappedToLast: shiftTabResult.wrappedToLast,
        };
      })()
    : {
        canTestTrap: false,
        tabFromLastStayedInDialog: false,
        tabFromLastWrappedToFirst: false,
        shiftTabFromFirstStayedInDialog: false,
        shiftTabFromFirstWrappedToLast: false,
      };
  const settingsThemeKeyboard = settingsOpened
    ? await (async () => {
        const canTestThemeKeyboard = await page.evaluate(() => {
          const radios = [...document.querySelectorAll('[role="radio"]')];
          const light = radios.find((radio) =>
            ["ライト", "Light"].some((label) => radio.textContent?.includes(label)),
          );

          if (!(light instanceof HTMLElement)) {
            return false;
          }

          light.focus();
          return document.activeElement === light;
        });

        if (!canTestThemeKeyboard) {
          return {
            canTestThemeKeyboard,
            arrowToDarkChecked: false,
            arrowToDarkClassApplied: false,
            arrowToDarkFocusOnDark: false,
            arrowBackToLightChecked: false,
            arrowBackToLightClassCleared: false,
            arrowBackToLightFocusOnLight: false,
            restoredWhiteBackground: false,
          };
        }

        await page.keyboard.press("ArrowRight");
        await page
          .waitForFunction(() => document.documentElement.classList.contains("dark"), null, {
            timeout: 2000,
          })
          .catch(() => undefined);
        await page
          .waitForFunction(
            () => {
              const radios = [...document.querySelectorAll('[role="radio"]')];
              const dark = radios.find((radio) =>
                ["ダーク", "Dark"].some((label) => radio.textContent?.includes(label)),
              );

              return document.activeElement === dark;
            },
            null,
            { timeout: 2000 },
          )
          .catch(() => undefined);
        const darkResult = await page.evaluate(() => {
          const radios = [...document.querySelectorAll('[role="radio"]')];
          const dark = radios.find((radio) =>
            ["ダーク", "Dark"].some((label) => radio.textContent?.includes(label)),
          );

          return {
            checked: dark?.getAttribute("aria-checked") === "true",
            classApplied: document.documentElement.classList.contains("dark"),
            focusOnDark: document.activeElement === dark,
          };
        });

        await page.keyboard.press("ArrowLeft");
        await page
          .waitForFunction(() => !document.documentElement.classList.contains("dark"), null, {
            timeout: 2000,
          })
          .catch(() => undefined);
        await page
          .waitForFunction(
            () => {
              const radios = [...document.querySelectorAll('[role="radio"]')];
              const light = radios.find((radio) =>
                ["ライト", "Light"].some((label) => radio.textContent?.includes(label)),
              );

              return document.activeElement === light;
            },
            null,
            { timeout: 2000 },
          )
          .catch(() => undefined);
        const lightResult = await page.evaluate(() => {
          const radios = [...document.querySelectorAll('[role="radio"]')];
          const light = radios.find((radio) =>
            ["ライト", "Light"].some((label) => radio.textContent?.includes(label)),
          );
          const app = document.querySelector("#root > div");
          const appStyle = app ? getComputedStyle(app) : null;

          return {
            checked: light?.getAttribute("aria-checked") === "true",
            classCleared: !document.documentElement.classList.contains("dark"),
            focusOnLight: document.activeElement === light,
            restoredWhiteBackground: appStyle?.backgroundColor === "rgb(255, 255, 255)",
          };
        });

        return {
          canTestThemeKeyboard,
          arrowToDarkChecked: darkResult.checked,
          arrowToDarkClassApplied: darkResult.classApplied,
          arrowToDarkFocusOnDark: darkResult.focusOnDark,
          arrowBackToLightChecked: lightResult.checked,
          arrowBackToLightClassCleared: lightResult.classCleared,
          arrowBackToLightFocusOnLight: lightResult.focusOnLight,
          restoredWhiteBackground: lightResult.restoredWhiteBackground,
        };
      })()
    : {
        canTestThemeKeyboard: false,
        arrowToDarkChecked: false,
        arrowToDarkClassApplied: false,
        arrowToDarkFocusOnDark: false,
        arrowBackToLightChecked: false,
        arrowBackToLightClassCleared: false,
        arrowBackToLightFocusOnLight: false,
        restoredWhiteBackground: false,
      };
  const settingsClose = settingsOpened
    ? await (async () => {
        await page.keyboard.press("Escape");
        await page
          .waitForFunction(() => !document.querySelector('[role="dialog"]'), null, {
            timeout: 2000,
          })
          .catch(() => undefined);
        await page
          .waitForFunction(
            () => {
              const settingsButton = [...document.querySelectorAll("button")].find((button) =>
                ["設定", "Settings"].includes(button.getAttribute("aria-label") || ""),
              );

              return document.activeElement === settingsButton;
            },
            null,
            { timeout: 2000 },
          )
          .catch(() => undefined);

        return page.evaluate(() => {
          const dialogs = [...document.querySelectorAll('[role="dialog"]')];
          const presentationLayers = [...document.querySelectorAll('[role="presentation"]')];
          const centerElement = document.elementFromPoint(
            window.innerWidth / 2,
            window.innerHeight / 2,
          );
          const effectiveBackgroundColor = (element) => {
            let current = element;
            while (current instanceof Element) {
              const backgroundColor = getComputedStyle(current).backgroundColor;
              if (!["rgba(0, 0, 0, 0)", "transparent"].includes(backgroundColor)) {
                return backgroundColor;
              }
              current = current.parentElement;
            }
            return getComputedStyle(document.documentElement).backgroundColor;
          };
          const settingsButton = [...document.querySelectorAll("button")].find((button) =>
            ["設定", "Settings"].includes(button.getAttribute("aria-label") || ""),
          );
          const htmlStyle = getComputedStyle(document.documentElement);
          const app = document.querySelector("#root > div");
          const appStyle = app ? getComputedStyle(app) : null;
          const centerStyle = centerElement ? getComputedStyle(centerElement) : null;
          const themeButton = [...document.querySelectorAll("button")].find((button) =>
            ["テーマ", "ダーク", "Theme", "Dark"].some((label) =>
              (button.getAttribute("aria-label") || "").includes(label),
            ),
          );

          return {
            closed: dialogs.length === 0,
            presentationLayerCount: presentationLayers.length,
            focusReturnedToSettingsButton: document.activeElement === settingsButton,
            finalDarkClass: document.documentElement.classList.contains("dark"),
            finalRootBg: htmlStyle.getPropertyValue("--bg").trim(),
            finalAppBg: appStyle?.backgroundColor ?? null,
            centerElementRole: centerElement?.getAttribute("role") ?? null,
            centerElementBg: centerStyle?.backgroundColor ?? null,
            centerEffectiveBg: effectiveBackgroundColor(centerElement),
            centerElementBackdropFilter: centerStyle?.backdropFilter ?? "",
            finalThemeTogglePressed: themeButton?.getAttribute("aria-pressed") ?? null,
          };
        });
      })()
    : {
        closed: false,
        presentationLayerCount: 1,
        focusReturnedToSettingsButton: false,
        finalDarkClass: true,
        finalRootBg: "",
        finalAppBg: null,
        centerElementRole: "presentation",
        centerElementBg: null,
        centerEffectiveBg: null,
        centerElementBackdropFilter: "",
        finalThemeTogglePressed: null,
      };
  const postCloseScreenshotBuffer = await page.screenshot({
    path: postCloseScreenshot,
    fullPage: true,
  });
  const postCloseScreenshotImage = pngMetadata(postCloseScreenshotBuffer);
  await page.reload({ waitUntil: "networkidle" });
  const reload = await page.evaluate((themeKeywords) => {
    const htmlStyle = getComputedStyle(document.documentElement);
    const app = document.querySelector("#root > div");
    const appStyle = app ? getComputedStyle(app) : null;
    const themeButton = [...document.querySelectorAll("button")].find((button) =>
      themeKeywords.some((label) => (button.getAttribute("aria-label") || "").includes(label)),
    );

    return {
      storedTheme: localStorage.getItem("figdiff-theme"),
      dark: document.documentElement.classList.contains("dark"),
      rootBg: htmlStyle.getPropertyValue("--bg").trim(),
      rootFg: htmlStyle.getPropertyValue("--fg").trim(),
      appBg: appStyle?.backgroundColor ?? null,
      themeTogglePressed: themeButton?.getAttribute("aria-pressed") ?? null,
      horizontalOverflow: document.body.scrollWidth > window.innerWidth,
    };
  }, themeNameIncludes);

  await page.close();

  return {
    viewport,
    result,
    settings,
    settingsKeyboard,
    settingsThemeKeyboard,
    settingsClose,
    reload,
    errors,
    screenshot: screenshotPath,
    screenshotBytes: screenshotBuffer.length,
    screenshotImage,
    settingsScreenshot,
    settingsScreenshotBytes: settingsScreenshotBuffer.length,
    settingsScreenshotImage,
    postCloseScreenshot,
    postCloseScreenshotBytes: postCloseScreenshotBuffer.length,
    postCloseScreenshotImage,
  };
};

const browser = await chromium.launch({ headless: true });
const results = await Promise.all([
  smokeViewport(browser, { width: 1280, height: 900 }, screenshot),
  smokeViewport(browser, { width: 390, height: 844 }, mobileScreenshot),
]);
await browser.close();

const failures = results.flatMap(
  ({
    result,
    settings,
    settingsKeyboard,
    settingsThemeKeyboard,
    settingsClose,
    reload,
    errors,
    viewport,
    screenshotBytes,
    screenshotImage,
    settingsScreenshotBytes,
    settingsScreenshotImage,
    postCloseScreenshotBytes,
    postCloseScreenshotImage,
  }) => {
    const rootIsWhite = ["#fff", "#ffffff"].includes(result.rootBg.toLowerCase());
    const rootTextIsDark = ["#09090b"].includes(result.rootFg.toLowerCase());
    const checkedThemeRadios = settings.radios.filter((radio) => radio.checked === "true");
    return [
      failureIf(errors.length, "browser console/page errors were emitted"),
      failureIf(result.dark, "html has stale dark class"),
      failureIf(!rootIsWhite, "light theme --bg is not white"),
      failureIf(!rootTextIsDark, "light theme --fg is not the expected dark foreground"),
      failureIf(result.appBg !== "rgb(255, 255, 255)", "app background is not white"),
      failureIf(!result.title, "home title did not render"),
      failureIf(!result.version, "version text did not render"),
      failureIf(result.visibleTextCount < 3, "home visible text audit found too few elements"),
      failureIf(result.lowContrastText.length, "home visible text contrast is below WCAG AA"),
      failureIf(
        result.visibleTargetCount < 4,
        "home interactive target audit found too few controls",
      ),
      failureIf(result.unnamedTargets.length, "home interactive target accessible name is missing"),
      failureIf(
        result.tooSmallTargets.length,
        "home interactive target size is below 24px minimum",
      ),
      failureIf(result.focusStepCount < 3, "home keyboard focus audit found too few controls"),
      failureIf(result.missingVisibleFocus.length, "home keyboard focus indicator is not visible"),
      failureIf(result.formControlCount < 1, "home form control audit found too few controls"),
      failureIf(
        result.unlabeledFormControls.length,
        "home form control accessible label is missing",
      ),
      failureIf(result.duplicateIds.length, "home contains duplicate ids"),
      failureIf(!result.buttons.length, "theme toggle accessible state did not render"),
      failureIf(
        !result.buttons.some((button) => button.name && button.pressed !== null),
        "theme toggle aria-pressed did not render",
      ),
      failureIf(
        !result.buttons.some((button) => button.pressed === "false"),
        "theme toggle is not in initial light state",
      ),
      failureIf(
        result.mainHeight < Math.min(400, viewport.height * 0.6),
        "main content height is unexpectedly small",
      ),
      failureIf(result.horizontalOverflow, "body has horizontal overflow"),
      failureIf(screenshotBytes < 5000, "home screenshot is unexpectedly small"),
      failureIf(!screenshotImage.isPng, "home screenshot is not a PNG"),
      failureIf(
        screenshotImage.width !== viewport.width,
        "home screenshot width does not match viewport",
      ),
      failureIf(
        screenshotImage.height < viewport.height,
        "home screenshot height is smaller than viewport",
      ),
      failureIf(!settings.opened, "settings dialog did not open"),
      failureIf(settings.dialogCount !== 1, "settings dialog count is not exactly one"),
      failureIf(settings.modal !== "true", "settings dialog is not aria-modal"),
      failureIf(!settings.labelledById, "settings dialog aria-labelledby is missing"),
      failureIf(!settings.describedById, "settings dialog aria-describedby is missing"),
      failureIf(
        settings.labelledByCount !== 1,
        "settings dialog aria-labelledby target is not unique",
      ),
      failureIf(
        settings.describedByCount !== 1,
        "settings dialog aria-describedby target is not unique",
      ),
      failureIf(!settings.label, "settings dialog accessible label is empty"),
      failureIf(!settings.description, "settings dialog accessible description is empty"),
      failureIf(
        settings.visibleTextCount < 6,
        "settings visible text audit found too few elements",
      ),
      failureIf(settings.lowContrastText.length, "settings visible text contrast is below WCAG AA"),
      failureIf(
        settings.visibleTargetCount < 5,
        "settings interactive target audit found too few controls",
      ),
      failureIf(
        settings.unnamedTargets.length,
        "settings interactive target accessible name is missing",
      ),
      failureIf(
        settings.tooSmallTargets.length,
        "settings interactive target size is below 24px minimum",
      ),
      failureIf(
        settings.focusStepCount < 3,
        "settings keyboard focus audit found too few controls",
      ),
      failureIf(
        settings.missingVisibleFocus.length,
        "settings keyboard focus indicator is not visible",
      ),
      failureIf(
        settings.formControlCount < 2,
        "settings form control audit found too few controls",
      ),
      failureIf(
        settings.unlabeledFormControls.length,
        "settings form control accessible label is missing",
      ),
      failureIf(settings.duplicateIds.length, "settings dialog contains duplicate ids"),
      failureIf(
        !settings.closeButtonLabel,
        "settings dialog close button accessible label is empty",
      ),
      failureIf(!settings.activeElementInDialog, "settings dialog did not receive focus"),
      failureIf(!settingsKeyboard.canTestTrap, "settings dialog focus trap could not be tested"),
      failureIf(
        !settingsKeyboard.tabFromLastStayedInDialog,
        "settings dialog Tab from last control left the dialog",
      ),
      failureIf(
        !settingsKeyboard.tabFromLastWrappedToFirst,
        "settings dialog Tab from last control did not wrap to first control",
      ),
      failureIf(
        !settingsKeyboard.shiftTabFromFirstStayedInDialog,
        "settings dialog Shift+Tab from first control left the dialog",
      ),
      failureIf(
        !settingsKeyboard.shiftTabFromFirstWrappedToLast,
        "settings dialog Shift+Tab from first control did not wrap to last control",
      ),
      failureIf(
        !settingsThemeKeyboard.canTestThemeKeyboard,
        "settings theme radio keyboard interaction could not be tested",
      ),
      failureIf(
        !settingsThemeKeyboard.arrowToDarkChecked,
        "settings theme radio ArrowRight did not check dark theme",
      ),
      failureIf(
        !settingsThemeKeyboard.arrowToDarkClassApplied,
        "settings theme radio ArrowRight did not apply dark class",
      ),
      failureIf(
        !settingsThemeKeyboard.arrowToDarkFocusOnDark,
        "settings theme radio ArrowRight did not move focus to dark theme",
      ),
      failureIf(
        !settingsThemeKeyboard.arrowBackToLightChecked,
        "settings theme radio ArrowLeft did not check light theme",
      ),
      failureIf(
        !settingsThemeKeyboard.arrowBackToLightClassCleared,
        "settings theme radio ArrowLeft did not clear dark class",
      ),
      failureIf(
        !settingsThemeKeyboard.arrowBackToLightFocusOnLight,
        "settings theme radio ArrowLeft did not move focus to light theme",
      ),
      failureIf(
        !settingsThemeKeyboard.restoredWhiteBackground,
        "settings theme radio ArrowLeft did not restore white app background",
      ),
      failureIf(!settingsClose.closed, "settings dialog did not close with Escape"),
      failureIf(
        settingsClose.presentationLayerCount !== 0,
        "settings dialog backdrop/presentation layer remained after close",
      ),
      failureIf(
        !settingsClose.focusReturnedToSettingsButton,
        "settings dialog did not restore focus after Escape",
      ),
      failureIf(settingsClose.finalDarkClass, "app retained dark class after settings close"),
      failureIf(
        !["#fff", "#ffffff"].includes(settingsClose.finalRootBg.toLowerCase()),
        "app root background is not white after settings close",
      ),
      failureIf(
        settingsClose.finalAppBg !== "rgb(255, 255, 255)",
        "app background is not white after settings close",
      ),
      failureIf(
        settingsClose.centerElementRole === "presentation",
        "post-close center point is still covered by presentation layer",
      ),
      failureIf(
        settingsClose.centerElementBackdropFilter !== "none",
        "post-close center point still has backdrop filter",
      ),
      failureIf(
        !isBrightColor(settingsClose.centerEffectiveBg ?? ""),
        "post-close center point effective background is not bright white",
      ),
      failureIf(
        settingsClose.finalThemeTogglePressed !== "false",
        "theme toggle is not in light state after settings close",
      ),
      failureIf(
        reload.storedTheme !== "light",
        "persisted theme is not light after settings dark-to-light roundtrip",
      ),
      failureIf(reload.dark, "app restored dark class after reload"),
      failureIf(
        !["#fff", "#ffffff"].includes(reload.rootBg.toLowerCase()),
        "app root background is not white after reload",
      ),
      failureIf(
        !["#09090b"].includes(reload.rootFg.toLowerCase()),
        "app root foreground is not expected dark color after reload",
      ),
      failureIf(reload.appBg !== "rgb(255, 255, 255)", "app background is not white after reload"),
      failureIf(
        reload.themeTogglePressed !== "false",
        "theme toggle is not in light state after reload",
      ),
      failureIf(reload.horizontalOverflow, "body has horizontal overflow after reload"),
      failureIf(settings.bg !== "rgb(255, 255, 255)", "settings dialog background is not white"),
      failureIf(settings.width > viewport.width, "settings dialog is wider than viewport"),
      failureIf(settings.height > viewport.height, "settings dialog is taller than viewport"),
      failureIf(settings.left < 0, "settings dialog starts outside left viewport edge"),
      failureIf(settings.top < 0, "settings dialog starts outside top viewport edge"),
      failureIf(settings.right > viewport.width, "settings dialog exceeds right viewport edge"),
      failureIf(settings.bottom > viewport.height, "settings dialog exceeds bottom viewport edge"),
      failureIf(!settings.themeGroup, "settings theme radiogroup did not render"),
      failureIf(!settings.themeGroupLabel, "settings theme radiogroup accessible label is empty"),
      failureIf(settings.radios.length < 2, "settings theme radios did not render"),
      failureIf(
        settings.radios.some((radio) => !["false", "true"].includes(radio.checked)),
        "settings theme radio aria-checked state is invalid",
      ),
      failureIf(
        checkedThemeRadios.length !== 1,
        "settings theme radios do not have one checked option",
      ),
      failureIf(
        !settings.radios.some((radio) => isLightRadio(radio) && radio.checked === "true"),
        "settings light theme radio is not checked",
      ),
      failureIf(
        settings.radios.some((radio) => isDarkRadio(radio) && radio.checked === "true"),
        "settings dark theme radio is unexpectedly checked",
      ),
      failureIf(settings.horizontalOverflow, "settings dialog has horizontal overflow"),
      failureIf(settingsScreenshotBytes < 5000, "settings screenshot is unexpectedly small"),
      failureIf(!settingsScreenshotImage.isPng, "settings screenshot is not a PNG"),
      failureIf(
        settingsScreenshotImage.width !== viewport.width,
        "settings screenshot width does not match viewport",
      ),
      failureIf(
        settingsScreenshotImage.height < viewport.height,
        "settings screenshot height is smaller than viewport",
      ),
      failureIf(postCloseScreenshotBytes < 5000, "post-close screenshot is unexpectedly small"),
      failureIf(!postCloseScreenshotImage.isPng, "post-close screenshot is not a PNG"),
      failureIf(
        postCloseScreenshotImage.width !== viewport.width,
        "post-close screenshot width does not match viewport",
      ),
      failureIf(
        postCloseScreenshotImage.height < viewport.height,
        "post-close screenshot height is smaller than viewport",
      ),
    ]
      .filter(Boolean)
      .map((failure) => `${viewport.width}x${viewport.height}: ${failure}`);
  },
);

const summary = { results };

if (failures.length) {
  fail("White theme browser smoke failed.", { ...summary, failures });
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
