// Per-icon imports keep the bundle small (Metro doesn't tree-shake the package index).
import ArrowUpDown from 'lucide-react-native/icons/arrow-up-down';
import Award from 'lucide-react-native/icons/award';
import Bell from 'lucide-react-native/icons/bell';
import Calendar from 'lucide-react-native/icons/calendar';
import Camera from 'lucide-react-native/icons/camera';
import Car from 'lucide-react-native/icons/car';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import Circle from 'lucide-react-native/icons/circle';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import CirclePlus from 'lucide-react-native/icons/circle-plus';
import CircleQuestionMark from 'lucide-react-native/icons/circle-question-mark';
import CircleX from 'lucide-react-native/icons/circle-x';
import Clock from 'lucide-react-native/icons/clock';
import Compass from 'lucide-react-native/icons/compass';
import CreditCard from 'lucide-react-native/icons/credit-card';
import Flag from 'lucide-react-native/icons/flag';
import Globe from 'lucide-react-native/icons/globe';
import Hash from 'lucide-react-native/icons/hash';
import Heart from 'lucide-react-native/icons/heart';
import House from 'lucide-react-native/icons/house';
import Info from 'lucide-react-native/icons/info';
import Layers from 'lucide-react-native/icons/layers';
import LayoutGrid from 'lucide-react-native/icons/layout-grid';
import Lock from 'lucide-react-native/icons/lock';
import LogOut from 'lucide-react-native/icons/log-out';
import MapPin from 'lucide-react-native/icons/map-pin';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import MessageSquare from 'lucide-react-native/icons/message-square';
import Minus from 'lucide-react-native/icons/minus';
import OctagonAlert from 'lucide-react-native/icons/octagon-alert';
import Package from 'lucide-react-native/icons/package';
import Pencil from 'lucide-react-native/icons/pencil';
import Plus from 'lucide-react-native/icons/plus';
import Receipt from 'lucide-react-native/icons/receipt';
import RefreshCcw from 'lucide-react-native/icons/refresh-ccw';
import Search from 'lucide-react-native/icons/search';
import Settings from 'lucide-react-native/icons/settings';
import Share from 'lucide-react-native/icons/share';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import ShoppingCart from 'lucide-react-native/icons/shopping-cart';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import Smartphone from 'lucide-react-native/icons/smartphone';
import SquareCheck from 'lucide-react-native/icons/square-check';
import Star from 'lucide-react-native/icons/star';
import Store from 'lucide-react-native/icons/store';
import Tag from 'lucide-react-native/icons/tag';
import Trash from 'lucide-react-native/icons/trash';
import TrendingUp from 'lucide-react-native/icons/trending-up';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import Truck from 'lucide-react-native/icons/truck';
import Undo2 from 'lucide-react-native/icons/undo-2';
import User from 'lucide-react-native/icons/user';
import Wrench from 'lucide-react-native/icons/wrench';
import X from 'lucide-react-native/icons/x';
import Zap from 'lucide-react-native/icons/zap';
import type { LucideIcon } from 'lucide-react-native';

import { useI18n } from '@/i18n';
import { colors } from '@/theme/tokens';

/**
 * Icon set (guidelines p.15): 24×24 grid, 1.75 stroke, rounded caps and joins, simple geometry.
 * Names are semantic so call sites don't depend on the underlying library (Lucide).
 */
const ICONS = {
  'alert-circle': CircleAlert,
  'alert-octagon': OctagonAlert,
  'alert-triangle': TriangleAlert,
  award: Award,
  'bar-chart-2': ArrowUpDown,
  bell: Bell,
  calendar: Calendar,
  camera: Camera,
  car: Car,
  check: Check,
  'check-circle': CircleCheck,
  'check-square': SquareCheck,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  circle: Circle,
  clock: Clock,
  compass: Compass,
  'credit-card': CreditCard,
  'edit-2': Pencil,
  flag: Flag,
  globe: Globe,
  grid: LayoutGrid,
  hash: Hash,
  heart: Heart,
  'help-circle': CircleQuestionMark,
  home: House,
  info: Info,
  layers: Layers,
  lock: Lock,
  'log-out': LogOut,
  'map-pin': MapPin,
  'message-circle': MessageCircle,
  'message-square': MessageSquare,
  minus: Minus,
  package: Package,
  plus: Plus,
  'plus-circle': CirclePlus,
  receipt: Receipt,
  'refresh-ccw': RefreshCcw,
  'rotate-ccw': Undo2,
  search: Search,
  settings: Settings,
  share: Share,
  shield: ShieldCheck,
  'shopping-bag': ShoppingCart,
  sliders: SlidersHorizontal,
  smartphone: Smartphone,
  star: Star,
  store: Store,
  tag: Tag,
  tool: Wrench,
  'trash-2': Trash,
  'trending-up': TrendingUp,
  truck: Truck,
  user: User,
  x: X,
  'x-circle': CircleX,
  zap: Zap,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

const DIRECTIONAL = new Set<IconName>(['chevron-right', 'chevron-left', 'log-out']);

type Props = {
  name: IconName;
  size?: number;
  color?: keyof typeof colors | string;
  /** Filled glyph (e.g. a saved favorite). */
  filled?: boolean;
};

/** Direction-sensitive glyphs (chevrons) mirror automatically in RTL. */
export function Icon({ name, size = 20, color = 'text', filled }: Props) {
  const { isRTL } = useI18n();
  const resolved = color in colors ? colors[color as keyof typeof colors] : color;
  const Glyph = ICONS[name];
  const flip = isRTL && DIRECTIONAL.has(name);
  return (
    <Glyph
      size={size}
      color={resolved}
      strokeWidth={1.75}
      absoluteStrokeWidth={size < 18}
      fill={filled ? resolved : 'none'}
      style={flip ? { transform: [{ scaleX: -1 }] } : undefined}
    />
  );
}
