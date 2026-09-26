"""
Style-to-effects preset map for car-edit skill.
Each style is a list of effect dicts with MoviePy effect names and parameters.
"""

PRESETS = {
    "cinematic": [
        {"effect": "LumContrast", "params": {"lum": 0, "contrast": 0.2}},
        {"effect": "GammaCorrection", "params": {"gamma": 0.85}},
        {"effect": "FadeIn", "params": {"duration": 1.5}},
        {"effect": "FadeOut", "params": {"duration": 1.5}},
        {"effect": "Resize", "params": {"new_size": (1920, 817)}},  # 2.35:1 letterbox
        {"effect": "MultiplySpeed", "params": {"factor": 0.8}},
    ],
    "aggressive": [
        {"effect": "LumContrast", "params": {"lum": 10, "contrast": 0.4}},
        {"effect": "GammaCorrection", "params": {"gamma": 1.2}},
        {"effect": "MultiplySpeed", "params": {"factor": 1.5}},
        {"effect": "FadeIn", "params": {"duration": 0.2}},
        {"effect": "FadeOut", "params": {"duration": 0.2}},
    ],
    "clean": [
        {"effect": "EvenSize", "params": {}},
        {"effect": "LumContrast", "params": {"lum": 5, "contrast": 0.1}},
        {"effect": "FadeIn", "params": {"duration": 0.8}},
        {"effect": "FadeOut", "params": {"duration": 0.8}},
    ],
    "moody": [
        {"effect": "LumContrast", "params": {"lum": -15, "contrast": 0.35}},
        {"effect": "GammaCorrection", "params": {"gamma": 0.7}},
        {"effect": "FadeIn", "params": {"duration": 2.0}},
        {"effect": "FadeOut", "params": {"duration": 2.0}},
        {"effect": "MultiplySpeed", "params": {"factor": 0.6}},
    ],
}

STYLE_NAMES = list(PRESETS.keys())
