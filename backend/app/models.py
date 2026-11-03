import math
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

KIND_RE = re.compile(r"^[a-z][a-z0-9_]{0,48}$")


def _check_pos(p) -> None:
    if (not isinstance(p, (list, tuple)) or len(p) < 2
            or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in p[:2])):
        raise ValueError("invalid position")
    if not (-180 <= p[0] <= 180 and -90 <= p[1] <= 90):
        raise ValueError("position out of range")


class Geometry(BaseModel):
    type: Literal["Point", "LineString", "Polygon"]
    coordinates: Any

    @field_validator("coordinates")
    @classmethod
    def _coords(cls, v, info):
        t = info.data.get("type")
        if t == "Point":
            _check_pos(v)
        elif t == "LineString":
            if len(v) < 2:
                raise ValueError("LineString needs 2+ positions")
            for p in v:
                _check_pos(p)
        elif t == "Polygon":
            if not v:
                raise ValueError("Polygon needs a ring")
            for ring in v:
                if len(ring) < 4 or ring[0] != ring[-1]:
                    raise ValueError("Polygon rings must be closed with 4+ positions")
                for p in ring:
                    _check_pos(p)
        return v


class LayerIn(BaseModel):
    id: str
    key: str
    name: str = Field(max_length=120)
    group: str = ""
    color: str = "#6ee7a8"
    visible: bool = True
    locked: bool = False
    order: int = 0


class ObjectIn(BaseModel):
    id: str
    layerId: str
    kind: str
    name: str = Field(default="", max_length=200)
    geometry: Geometry
    props: dict[str, Any] = Field(default_factory=dict)

    @field_validator("kind")
    @classmethod
    def _kind(cls, v):
        if not KIND_RE.match(v):
            raise ValueError("invalid kind")
        return v


class ViewIn(BaseModel):
    center: tuple[float, float]
    zoom: float = 17
    bearing: float = 0
    pitch: float = 0


class ChangeSet(BaseModel):
    layers: list[LayerIn] = []
    deleteLayers: list[str] = []
    objects: list[ObjectIn] = []
    deleteObjects: list[str] = []
    view: ViewIn | None = None
    baseMap: str | None = None
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None


class PropertyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    center: tuple[float, float]
    zoom: float = 17


class OverlayIn(BaseModel):
    name: str | None = None
    corners: list[tuple[float, float]] | None = None
    opacity: float | None = Field(default=None, ge=0, le=1)
    visible: bool | None = None


class SettingsIn(BaseModel):
    satelliteProvider: str | None = None
    customTilesUrl: str | None = None
    customAttribution: str | None = None
    esriMaxZoom: int | None = None
    maptilerKey: str | None = None      # empty string clears
    customKey: str | None = None
